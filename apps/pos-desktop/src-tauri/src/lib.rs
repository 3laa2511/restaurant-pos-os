use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Manager, State};

struct DbState(Mutex<Option<Connection>>);

#[derive(Serialize)]
struct Health {
    engine: &'static str,
    sqlite: bool,
    schema_version: i64,
}

const SCHEMA: &str = include_str!("../../src/pos/sqlite-schema.sql");

fn initialize_connection() -> SqlResult<Connection> {
    let connection = Connection::open("restaurant-pos.db")?;
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")?;
    connection.execute_batch(SCHEMA)?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);\
         INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1');"
    )?;
    Ok(connection)
}

#[tauri::command]
fn initialize_database(state: State<'_, DbState>) -> Result<Health, String> {
    let connection = initialize_connection().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "database lock poisoned".to_string())? = Some(connection);
    Ok(Health { engine: "sqlite", sqlite: true, schema_version: 1 })
}

fn execute_sql(connection: &Connection, sql: &str) -> SqlResult<()> {
    connection.execute_batch(sql)
}

#[tauri::command]
fn execute(state: State<'_, DbState>, sql: String) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    let connection = guard.as_ref().ok_or_else(|| "database is not initialized".to_string())?;
    execute_sql(connection, &sql).map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![initialize_database, execute, database_health])
        .run(tauri::generate_context!())
        .expect("error while running restaurant POS");
}
