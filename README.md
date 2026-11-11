# TaskPro Dynamic – Online Project

A lightweight full-stack Task & Project Management System built with Node.js and vanilla HTML/CSS/JavaScript. It runs in Replit or any Node.js hosting environment.

## Features
- Login and Register (passwords hashed with Node.js scrypt)
- Dashboard statistics from persistent server-side JSON data
- Projects: create, edit, delete, list
- Tasks: create, edit, delete, assign to registered users
- Admin / Member roles and Admin role management
- Task priority, status, due date
- Responsive layout

## Run on Replit
1. Create a new Replit app using the Node.js template.
2. Upload/import all files in this project, keeping the `public` folder.
3. Run `npm start` (or press Run if Replit detects `package.json`).
4. Open the Preview / Webview.
5. Publish from Replit when ready to share the public URL.

## Demo Admin
- Email: `admin@taskpro.com`
- Password: `password`

The first run creates `data.json` and seeds this demo Admin. Register new users through the Register link; all new accounts have the Member role.

## Important database note
This quick online version stores records in `data.json` on the Node.js server rather than MySQL/PostgreSQL. It is suitable for a fast classroom demonstration and local Replit workspace testing. For production or deployment where persistent storage is required, connect a managed database (such as Replit PostgreSQL) and migrate the data layer. Do not rely on a local JSON file as a production database.
