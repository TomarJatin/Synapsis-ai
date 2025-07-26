# GitHub Documentation Creator 📚

A powerful tool built with **Next.js 14** and **NestJS** that analyzes GitHub repositories using AI to extract features, understand architecture, and generate comprehensive, searchable documentation.

## ✨ Features

- **Repository Analysis**: Automatically analyze GitHub repositories to understand their structure and features
- **AI-Powered**: Uses Anthropic's Claude to intelligently extract and categorize repository information
- **Feature Detection**: Identifies authentication systems, APIs, database operations, UI components, and more
- **Architecture Understanding**: Analyzes code patterns, project structure, and technology stack
- **AST Generation**: Converts code into Abstract Syntax Trees for future search capabilities
- **Beautiful UI**: Modern, responsive interface built with shadcn/ui components
- **Real-time Progress**: Live updates during analysis with polling for completion status

## 🏗️ Architecture

### Backend (NestJS + Prisma + MongoDB)
- **GitHub Integration**: Fetch repositories and code using GitHub API
- **LLM Analysis**: Process code with Anthropic Claude for intelligent feature extraction
- **Database**: Store analysis results in MongoDB with JSON-based searchable content
- **RESTful API**: Clean API endpoints for repository operations

### Frontend (Next.js 14)
- **Repository Browser**: View and search GitHub repositories
- **Analysis Dashboard**: Real-time analysis progress and results display
- **Type-Safe**: Full TypeScript support with proper API types

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- pnpm
- MongoDB database (local or cloud)
- GitHub Personal Access Token
- Anthropic API Key

### 1. Clone the Repository
```bash
git clone <repository-url>
cd Synapsis-ai
```

### 2. Backend Setup
```bash
cd server

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Edit .env with your credentials
nano .env
```

**Required Environment Variables:**
```env
# Database
DATABASE_URL="mongodb://localhost:27017/synapsis-ai"

# GitHub Configuration  
GITHUB_ACCESS_TOKEN="your-github-personal-access-token"
GITHUB_ORGANIZATION="your-github-organization-name"

# Anthropic API
ANTHROPIC_API_KEY="your-anthropic-api-key"

# Server Configuration
PORT=3000
API_URL="http://localhost:3000"
FRONTEND_URL="http://localhost:3001"
JWT_SECRET="your-super-secret-jwt-key"
API_KEY="your-api-key"
```

```bash
# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Start the server
pnpm start:dev
```

### 3. Frontend Setup
```bash
cd ../web

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Edit with your API URL
echo 'NEXT_PUBLIC_API_URL="http://localhost:3000"' > .env

# Start the development server
pnpm dev
```

### 4. Access the Application
- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:3000
- **API Documentation**: http://localhost:3000/api (Swagger)

## 📖 Usage Guide

### 1. Load GitHub Repositories
- Navigate to the **GitHub Repositories** tab
- Enter your organization name (optional)
- Click **Load Repositories** to fetch from GitHub

### 2. Save Repositories
- Browse the loaded repositories
- Click **Save Repository** on repositories you want to analyze
- Saved repositories appear in the **Saved Repositories** tab

### 3. Analyze Repositories
- Go to **Saved Repositories** tab
- Click **Analyze** on any saved repository
- Monitor real-time progress with automatic status updates

### 4. View Analysis Results
- Once analysis completes, click **View Analysis**
- Explore extracted features, architecture patterns, and technology stack
- View detailed summaries and implementation insights

## 🔧 API Endpoints

### Repositories
- `GET /repositories` - Fetch repositories from GitHub
- `GET /repositories/local` - Get saved repositories
- `POST /repositories/save` - Save a repository
- `GET /repositories/:id` - Get repository details
- `POST /repositories/:id/analyze` - Start analysis
- `GET /repositories/:id/analysis` - Get analysis results
- `GET /repositories/:id/analysis/status` - Get analysis status

## 🎯 Analysis Output

The AI analysis extracts:

### Features
- **Authentication Systems**: Login, OAuth, JWT handling
- **API Endpoints**: REST APIs, GraphQL, service integrations  
- **Database Operations**: Models, migrations, queries
- **UI Components**: React components, pages, layouts
- **Testing Setup**: Unit tests, integration tests, E2E
- **Deployment**: Docker, CI/CD, infrastructure configs

### Architecture
- **Patterns**: MVC, microservices, monolith analysis
- **Structure**: Directory organization and purpose
- **Entry Points**: Main application files
- **Technology Stack**: Frontend, backend, database technologies

### Code Metrics
- Lines of code and file counts
- Complexity assessment (low/medium/high)
- Maintainability score
- Language distribution

## 🛠️ Technology Stack

### Backend
- **NestJS** - Progressive Node.js framework
- **Prisma** - Next-generation ORM
- **MongoDB** - Document database
- **Anthropic SDK** - Claude AI integration
- **Octokit** - GitHub API client

### Frontend  
- **Next.js 14** - React framework with App Router
- **shadcn/ui** - Modern UI components
- **Tailwind CSS** - Utility-first CSS
- **TypeScript** - Type safety
- **Sonner** - Toast notifications

## 🔒 Security & Best Practices

- Environment variables for sensitive data
- Type-safe API communication  
- Input validation with DTOs
- Error handling and logging
- Rate limiting considerations for GitHub API

## 🚧 Future Enhancements

- **Advanced Search**: Full-text search through analysis data
- **Comparison Tool**: Compare architectures across repositories
- **Export Features**: Generate documentation files (PDF, Markdown)
- **Team Collaboration**: Multi-user support and sharing
- **Integration**: Webhooks for automatic analysis on repository updates

## 📝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation in `/docs`
- Review the API documentation at `/api` endpoint

---

**Built with ❤️ for developers who want to understand and reuse great code.**
