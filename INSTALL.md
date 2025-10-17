# Installation Guide

Platform-specific installation instructions for the Codebase Index CLI.

## Table of Contents

- [Linux](#linux)
- [macOS](#macos)
- [Windows](#windows)
- [Manual Installation (All Platforms)](#manual-installation-all-platforms)

---

## Prerequisites (All Platforms)

Before installing, make sure you have:

1. **Node.js** (>= 18.x)
   - Download from: https://nodejs.org/
   - Verify: `node --version`

2. **pnpm** (package manager)
   - Install: `npm install -g pnpm`
   - Or visit: https://pnpm.io/installation
   - Verify: `pnpm --version`

---

## Linux

### Automatic Installation

```bash
# Clone the repository
git clone https://github.com/dudufcb1/codebase-index-cli.git
cd codebase-index-cli

# Run the installer
./scripts/install.sh
```

The script will:
- Install dependencies
- Build the CLI
- Create command wrappers in `~/.local/bin/`:
  - `codebase` - Uses Qdrant
  - `codesql` - Uses SQLite-vec
  - `codebase-index` - Legacy compatibility

### Add to PATH

If `~/.local/bin` is not in your PATH, add this to your `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then reload your shell:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

---

## macOS

> **⚠️ Note:** This installation script has not been tested on macOS. If you test it and it works (or needs modifications), please submit a PR with your tested configuration!

### Automatic Installation

```bash
# Clone the repository
git clone https://github.com/dudufcb1/codebase-index-cli.git
cd codebase-index-cli

# Run the macOS installer
./scripts/install-macos.sh
```

The script will:
- Install dependencies
- Build the CLI
- Create command wrappers in `~/.local/bin/`:
  - `codebase` - Uses Qdrant
  - `codesql` - Uses SQLite-vec
  - `codebase-index` - Legacy compatibility

### Add to PATH

macOS uses `zsh` by default (since Catalina). Add to your `~/.zshrc`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

For older macOS versions using bash:
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bash_profile
source ~/.bash_profile
```

---

## Windows

> **⚠️ Note:** This installation script has not been tested on Windows. If you test it and it works (or needs modifications), please submit a PR with your tested configuration!

### Automatic Installation (PowerShell)

```powershell
# Clone the repository
git clone https://github.com/dudufcb1/codebase-index-cli.git
cd codebase-index-cli

# Run the PowerShell installer
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The script will:
- Install dependencies
- Build the CLI
- Create batch files in `%USERPROFILE%\.local\bin\`:
  - `codebase.bat` - Uses Qdrant
  - `codesql.bat` - Uses SQLite-vec
  - `codebase-index.bat` - Legacy compatibility

### Add to PATH (Windows)

**Option 1: GUI Method**
1. Press `Win + R`, type `sysdm.cpl`, press Enter
2. Go to "Advanced" tab → "Environment Variables"
3. Under "User variables", select "Path" → "Edit"
4. Click "New" and add: `%USERPROFILE%\.local\bin`
5. Click "OK" on all dialogs
6. **Restart your terminal**

**Option 2: PowerShell (Admin required)**
```powershell
[Environment]::SetEnvironmentVariable('Path', $env:Path + ";$env:USERPROFILE\.local\bin", 'User')
```
Then **restart your terminal**.

### Creating Aliases (Optional - Windows)

Since Windows doesn't support aliases in the same way as Unix, you can use PowerShell profiles:

1. Open PowerShell profile for editing:
   ```powershell
   notepad $PROFILE
   ```
   (If file doesn't exist, create it first: `New-Item -Path $PROFILE -Type File -Force`)

2. Add these functions (optional shortcuts):
   ```powershell
   function cb { codebase $args }
   function cbsql { codesql $args }
   ```

3. Save and reload:
   ```powershell
   . $PROFILE
   ```

---

## Manual Installation (All Platforms)

If the automatic scripts don't work, you can install manually:

### 1. Clone and Build

```bash
git clone https://github.com/dudufcb1/codebase-index-cli.git
cd codebase-index-cli
pnpm install
pnpm run build
```

### 2. Create Aliases/Commands

#### Linux/macOS - Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Get the repository path
CODEBASE_CLI_PATH="/path/to/codebase-index-cli"

# Create aliases
alias codebase="VECTOR_STORE=qdrant node $CODEBASE_CLI_PATH/dist/index.js"
alias codesql="VECTOR_STORE=sqlite node $CODEBASE_CLI_PATH/dist/index.js"
alias codebase-index="node $CODEBASE_CLI_PATH/dist/index.js"
```

Replace `/path/to/codebase-index-cli` with the actual absolute path.

Then reload:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

#### Windows - PowerShell Profile Method:

1. Open PowerShell profile:
   ```powershell
   notepad $PROFILE
   ```

2. Add these functions:
   ```powershell
   $CODEBASE_CLI_PATH = "C:\path\to\codebase-index-cli"

   function codebase {
       $env:VECTOR_STORE = "qdrant"
       node "$CODEBASE_CLI_PATH\dist\index.js" $args
   }

   function codesql {
       $env:VECTOR_STORE = "sqlite"
       node "$CODEBASE_CLI_PATH\dist\index.js" $args
   }

   function codebase-index {
       node "$CODEBASE_CLI_PATH\dist\index.js" $args
   }
   ```

3. Save and reload:
   ```powershell
   . $PROFILE
   ```

---

## Verification

Test that the installation worked:

```bash
# Check if commands are available
codebase --help      # Should show help
codesql --help       # Should show help

# Or on Windows:
codebase.bat --help
codesql.bat --help
```

---

## Troubleshooting

### "Command not found" / "Not recognized as a command"

- **Linux/macOS**: Make sure `~/.local/bin` is in your PATH
- **Windows**: Make sure `%USERPROFILE%\.local\bin` is in your PATH and you've restarted your terminal

### "pnpm not found"

Install pnpm globally:
```bash
npm install -g pnpm
```

### Permission denied (Linux/macOS)

Make sure the scripts are executable:
```bash
chmod +x scripts/install.sh
chmod +x scripts/install-macos.sh
```

### PowerShell script won't run (Windows)

Run with execution policy bypass:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

---

## Contributing Installation Scripts

**If you test the macOS or Windows installation scripts and they work (or you fix them), please contribute back!**

1. Fork the repository
2. Test the script on your platform
3. Make any necessary fixes
4. Update this README with your findings
5. Submit a Pull Request

Your contribution will help other users on your platform!

---

## Next Steps

After installation, configure your environment:

1. Copy `.env.example` to `.env` in the repository root
2. Edit `.env` with your API keys and configuration
3. Start using the CLI:

```bash
# Using SQLite-vec (local)
codesql -start .

# Using Qdrant (requires Qdrant server)
codebase -start .
```

See the main [README.md](./README.md) for usage instructions.
