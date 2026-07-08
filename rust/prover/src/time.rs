//! Minimal, dependency-free UTC timestamp formatting for certificate metadata.
//!
//! Metadata is outside the verification boundary, so this only needs to produce
//! a plausible RFC 3339 string; we avoid pulling in a date crate.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current UTC time as an RFC 3339 string, e.g. `2026-07-08T12:34:56Z`.
pub fn now_rfc3339() -> String {
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0) as i64;

  let days = secs.div_euclid(86_400);
  let tod = secs.rem_euclid(86_400);
  let (year, month, day) = civil_from_days(days);
  let (hour, minute, second) = (tod / 3600, (tod % 3600) / 60, tod % 60);

  format!(
    "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
    year, month, day, hour, minute, second
  )
}

/// Convert days since the Unix epoch to a civil (year, month, day).
/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
  let z = z + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let doe = z - era * 146_097; // [0, 146096]
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
  let year = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
  let mp = (5 * doy + 2) / 153; // [0, 11]
  let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
  let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
  (year + if month <= 2 { 1 } else { 0 }, month, day)
}
