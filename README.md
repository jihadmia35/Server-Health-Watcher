# 🟢 Awakeify (Server Keep-Alive Dashboard)

A full-stack web application designed to solve the "cold start" problem for free-tier cloud hosting (like Render). It allows users to register, add their backend URLs, and automatically sends a ping every 14 minutes to keep the servers awake and ready. 

## ✨ Features

- **User Authentication:** Secure login and registration system for personalized server management.
- **Automated Keep-Alive:** A background cron job / interval process that hits user-defined endpoints every 14 minutes.
- **Real-Time Visualization:** Interactive graphs using Chart.js to monitor server health, response times, and uptime history.
- **Multi-Server Tracking:** Manage and monitor multiple backend URLs from a single, unified dashboard.
- **Modern Developer Aesthetic:** Built with a clean, minimalist "Cyber Grid" dark mode UI by default.
