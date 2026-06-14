# QB-SOA (Sistema de Organización de Almacén)

This repository contains **QB-SOA**, a comprehensive Web-based Warehouse Organization System (formerly QB-WMS) designed to facilitate inventory capture and synchronization using real-time WebSockets and SQL Server integration.

## Features
- **Real-Time Synchronization**: Uses Socket.IO for live inventory updates.
- **Dynamic Inventory Grids**: Driven by Tabulator with a premium, modern glassmorphism UI.
- **SQL Server Integration**: Securely connects to MSSQL via Node.js connection pooling.
- **Professional Aesthetic**: High-end translucent UI with Outfit typography.

## Getting Started

1. Clone the repository.
2. Run `npm install` to install dependencies (Express, Socket.IO, mssql, dotenv).
3. Create a `.env` file based on your database requirements.
4. Run `node server.js` or `npm run dev` to start the backend.
5. Access the interface at `http://localhost:5002`.

## Contributing
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
