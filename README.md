# Dashboard — Mac App Setup

## What you need first
- **Node.js** installed on your Mac — download from https://nodejs.org (get the LTS version)
- Your `command-dashboard.html` file

---

## Setup (one time)

### 1. Place your files
Put `command-dashboard.html` in the same folder as these files:
```
dashboard-app/
  main.js
  package.json
  command-dashboard.html   ← copy yours in here
  README.md
```

### 2. Open Terminal
Open Terminal (Applications → Utilities → Terminal) and navigate to this folder:
```bash
cd ~/Downloads/dashboard-app
```
(adjust the path if you put the folder somewhere else)

### 3. Install dependencies
```bash
npm install
```
This downloads Electron (~100MB). Takes about a minute.

### 4. Run it
```bash
npm start
```
Your dashboard opens as a native Mac window. ✓

---

## Build a proper .app you can drag to Applications

Once you've confirmed it runs, build a distributable .app:
```bash
npm run build
```

This creates a `dist/` folder containing:
- `Dashboard.dmg` — double-click to mount, then drag Dashboard.app to Applications

After that it lives in your Applications folder, appears in Spotlight, and has its own dock icon — exactly like any other Mac app.

---

## Add to Dock
1. Open Dashboard from Applications
2. Right-click the dock icon → Options → Keep in Dock

---

## Updating the dashboard
When you get a new version of `command-dashboard.html`, just replace the file in the `dashboard-app/` folder and rerun `npm start` or rebuild with `npm run build`.
