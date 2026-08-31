use rusqlite::{Connection, Result as SqlResult};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

struct DbState(Mutex<Option<Connection>>);

#[derive(Serialize)]
struct Health {
    engine: &'static str,
    sqlite: bool,
}

#[tauri::command]
fn initialize_database(state: State<'_, DbState>) -> Result<Health, String> {
    let connection = Connection::open("restaurant-pos.db").map_err(|e| e.to_string())?;
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "database lock poisoned".to_string())? = Some(connection);
    Ok(Health { engine: "sqlite", sqlite: true })
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
    Health { engine: "sqlite", sqlite: initialized }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![initialize_database, execute, database_health])
        .run(tauri::generate_context!())
        .expect("error while running restaurant POS");
}
