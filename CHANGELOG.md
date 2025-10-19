# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Process lock mechanism to prevent multiple `codebase -start` instances from running simultaneously in the same workspace
  - Uses `proper-lockfile` for cross-platform file-based locking
  - Lock file created at `.codebase/watcher.lock` when watcher starts
  - Clear error message when attempting to start duplicate instance, including workspace path and lock removal instructions
  - Automatic lock release on clean shutdown (SIGINT/SIGTERM)
  - Stale lock detection (10 second timeout) for crashed processes
  - Lock is properly cleaned up on graceful exit

### Changed
- Added `proper-lockfile` dependency (v4.1.2)
- Added `@types/proper-lockfile` dev dependency (v4.1.4)

## Previous Changes

See git history for changes prior to this changelog.
