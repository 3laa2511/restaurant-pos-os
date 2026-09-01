use rusqlite::{types::Value as SqlValue, Connection, Result as SqlResult, Statement};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};

struct DbState(Mutex<Option<Connection>>);

#[derive(Serialize)]
struct Health {
    engine: &'static str,
    sqlite: bool,
    schema_version: i64,
}

#[derive(Deserialize)]
struct SqlStatement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

const SCHEMA: &str = include_str!("../../src/pos/sqlite-schema.sql");

fn initialize_connection() -> SqlResult<Connection> {
    let connection = Connection::open("restaurant-pos.db")?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=2500;",
    )?;
    connection.execute_batch(SCHEMA)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1');",
    )?;
    Ok(connection)
}

fn json_to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(v) => SqlValue::Integer(i64::from(*v)),
        Value::Number(v) => {
            if let Some(i) = v.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = v.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Text(v.to_string())
            }
        }
        Value::String(v) => SqlValue::Text(v.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(value.to_string()),
    }
}

fn params_as_sql(params: &[Value]) -> Vec<SqlValue> {
    params.iter().map(json_to_sql).collect()
}

fn execute_statement(connection: &Connection, statement: &SqlStatement) -> SqlResult<()> {
    let params = params_as_sql(&statement.params);
    let mut stmt = connection.prepare(&statement.sql)?;
    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    stmt.execute(rusqlite::params_from_iter(refs))?;
    Ok(())
}

fn query_statement(connection: &Connection, statement: &SqlStatement) -> SqlResult<Vec<HashMap<String, Value>>> {
    let params = params_as_sql(&statement.params);
    let mut stmt: Statement<'_> = connection.prepare(&statement.sql)?;
    let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let column_names: Vec<String> = stmt.column_names().iter().map(|name| (*name).to_string()).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(refs))?;
    let mut output = Vec::new();

    while let Some(row) = rows.next()? {
        let mut record = HashMap::with_capacity(column_names.len());
        for (index, name) in column_names.iter().enumerate() {
            let value: SqlValue = row.get(index)?;
            let json_value = match value {
                SqlValue::Null => Value::Null,
                SqlValue::Integer(v) => Value::from(v),
                SqlValue::Real(v) => Value::from(v),
                SqlValue::Text(v) => Value::from(v),
                SqlValue::Blob(v) => Value::String(format!("blob:{}", hex::encode(v))),
            };
            record.insert(name.clone(), json_value);
        }
        output.push(record);
    }

    Ok(output)
}

#[tauri::command]
fn db_initialize(state: State<'_, DbState>) -> Result<Health, String> {
    let connection = initialize_connection().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "database lock poisoned".to_string())? = Some(connection);
    Ok(Health { engine: "sqlite", sqlite: true, schema_version: 1 })
}

#[tauri::command]
fn db_execute(state: State<'_, DbState>, sql: String, params: Vec<Value>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    let connection = guard.as_ref().ok_or_else(|| "database is not initialized".to_string())?;
    execute_statement(connection, &SqlStatement { sql, params }).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_query(state: State<'_, DbState>, sql: String, params: Vec<Value>) -> Result<Vec<HashMap<String, Value>>, String> {
    let guard = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    let connection = guard.as_ref().ok_or_else(|| "database is not initialized".to_string())?;
    query_statement(connection, &SqlStatement { sql, params }).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_transaction(state: State<'_, DbState>, statements: Vec<SqlStatement>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    let connection = guard.as_mut().ok_or_else(|| "database is not initialized".to_string())?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;

    for statement in &statements {
        execute_statement(&tx, statement).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn database_health(state: State<'_, DbState>) -> Health {
    let initialized = state.0.lock().ok().and_then(|g| g.as_ref().map(|_| true)).unwrap_or(false);
    Health { engine: "sqlite", sqlite: initialized, schema_version: if initialized { 1 } else { 0 } }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState(Mutex::new(None)))
        .setup(|app| {
            let state = app.state::<DbState>();
            let connection = initialize_connection().map_err(|e| e.to_string())?;
            *state.0.lock().map_err(|_| "database lock poisoned")? = Some(connection);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_initialize, db_execute, db_query, db_transaction, database_health])
        .run(tauri::generate_context!())
        .expect("error while running restaurant POS");
}
