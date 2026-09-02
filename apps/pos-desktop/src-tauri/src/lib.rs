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
const CURRENT_SCHEMA_VERSION: i64 = 4;

fn column_exists(connection: &Connection, table: &str, column: &str) -> SqlResult<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn migrate_schema(connection: &Connection) -> SqlResult<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )?;

    if !column_exists(connection, "sync_queue", "locked_by")? {
        connection.execute("ALTER TABLE sync_queue ADD COLUMN locked_by TEXT", [])?;
    }
    if !column_exists(connection, "sync_queue", "locked_until")? {
        connection.execute("ALTER TABLE sync_queue ADD COLUMN locked_until TEXT", [])?;
    }

    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS device_sequences (
            id TEXT PRIMARY KEY,
            device_id TEXT NOT NULL UNIQUE,
            next_sequence INTEGER NOT NULL DEFAULT 0 CHECK(next_sequence >= 0),
            updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_sync_queue_lease ON sync_queue(status, locked_until);",
    )?;

    if !column_exists(connection, "print_jobs", "order_number")? {
        connection.execute("ALTER TABLE print_jobs ADD COLUMN order_number TEXT NOT NULL DEFAULT ''", [])?;
    }
    if !column_exists(connection, "print_jobs", "copies")? {
        connection.execute("ALTER TABLE print_jobs ADD COLUMN copies INTEGER NOT NULL DEFAULT 1", [])?;
    }
    if !column_exists(connection, "print_jobs", "locked_by")? {
        connection.execute("ALTER TABLE print_jobs ADD COLUMN locked_by TEXT", [])?;
    }
    if !column_exists(connection, "print_jobs", "locked_until")? {
        connection.execute("ALTER TABLE print_jobs ADD COLUMN locked_until TEXT", [])?;
    }
    if !column_exists(connection, "print_jobs", "updated_at")? {
        connection.execute("ALTER TABLE print_jobs ADD COLUMN updated_at TEXT", [])?;
        connection.execute("UPDATE print_jobs SET updated_at = created_at WHERE updated_at IS NULL", [])?;
    }

    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_print_jobs_status_created ON print_jobs(status, created_at);
         CREATE INDEX IF NOT EXISTS idx_print_jobs_lease ON print_jobs(status, locked_until);
         INSERT INTO schema_meta(key, value) VALUES ('schema_version', '4')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
    )?;
    connection.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    Ok(())
}

fn initialize_connection() -> SqlResult<Connection> {
    let connection = Connection::open("restaurant-pos.db")?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=2500;",
    )?;
    connection.execute_batch(SCHEMA)?;
    migrate_schema(&connection)?;
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
                SqlValue::Blob(v) => Value::Array(v.into_iter().map(Value::from).collect()),
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
    Ok(Health { engine: "sqlite", sqlite: true, schema_version: CURRENT_SCHEMA_VERSION })
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

fn printer_name_for_station(station: &str) -> Option<String> {
    let key = match station {
        "KITCHEN" => "POS_PRINTER_KITCHEN",
        "BAR" => "POS_PRINTER_BAR",
        "CUSTOMER" => "POS_PRINTER_CUSTOMER",
        _ => "POS_PRINTER",
    };
    std::env::var(key).ok().filter(|value| !value.trim().is_empty()).or_else(|| {
        std::env::var("POS_PRINTER").ok().filter(|value| !value.trim().is_empty())
    })
}

#[tauri::command]
fn print_job(payload: String, copies: i64, station: String, order_number: String) -> Result<(), String> {
    if payload.is_empty() || payload.len() > 1_000_000 {
        return Err("print payload must be between 1 byte and 1 MB".to_string());
    }
    if !(1..=20).contains(&copies) {
        return Err("print copies must be between 1 and 20".to_string());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let safe_order = order_number.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(40).collect::<String>();
    let filename = format!("restaurant-pos-{}-{}.txt", safe_order, stamp);
    let path = std::env::temp_dir().join(filename);
    std::fs::write(&path, payload.as_bytes()).map_err(|e| format!("cannot spool print job: {e}"))?;

    let printer = printer_name_for_station(&station);
    let result = print_file(&path, copies, printer.as_deref());
    let _ = std::fs::remove_file(&path);
    result
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn print_file(path: &std::path::Path, copies: i64, printer: Option<&str>) -> Result<(), String> {
    let mut command = std::process::Command::new("lp");
    command.arg("-n").arg(copies.to_string());
    if let Some(printer) = printer {
        command.arg("-d").arg(printer);
    }
    let output = command.arg(path).output().map_err(|e| format!("printer command unavailable: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("printer rejected job: {}", String::from_utf8_lossy(&output.stderr).trim()))
    }
}

#[cfg(target_os = "windows")]
fn print_file(path: &std::path::Path, copies: i64, printer: Option<&str>) -> Result<(), String> {
    if printer.is_some() {
        return Err("station-specific Windows printers are not configured yet".to_string());
    }
    for _ in 0..copies {
        let path_text = path.to_string_lossy().replace('\\', "\\\\").replace('\"', "\\\"");
        let script = format!("Start-Process -FilePath \"{}\" -Verb Print -Wait", path_text);
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|e| format!("PowerShell print command unavailable: {e}"))?;
        if !output.status.success() {
            return Err(format!("printer rejected job: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
    }
    Ok(())
}

#[tauri::command]
fn database_health(state: State<'_, DbState>) -> Health {
    let initialized = state.0.lock().ok().and_then(|g| g.as_ref().map(|_| true)).unwrap_or(false);
    Health { engine: "sqlite", sqlite: initialized, schema_version: if initialized { CURRENT_SCHEMA_VERSION } else { 0 } }
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
        .invoke_handler(tauri::generate_handler![db_initialize, db_execute, db_query, db_transaction, print_job, database_health])
        .run(tauri::generate_context!())
        .expect("error while running restaurant POS");
}
