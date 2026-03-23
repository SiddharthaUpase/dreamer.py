# dreamer-py

CLI for [Dreamer](https://dreamer-py.vercel.app) — an AI-powered app builder.

## Install

```bash
npm install -g dreamer-py
```

## Usage

```bash
dreamer
```

On first run, the CLI will open your browser to authenticate via Google OAuth.

### Commands

| Command | Description |
|---------|-------------|
| `/projects` | List all projects |
| `/new <name>` | Create a new project |
| `/switch <name>` | Switch to a different project |
| `/delete <name>` | Delete a project |
| `/model` | Switch AI model |
| `/deploy` | Deploy to Vercel |
| `/clear` | Clear chat history |
| `/compact` | Compact chat history |
| `/history` | Show message count |
| `/url` | Show preview URL |
| `/logout` | Log out |
| `/exit` | Exit |

### File Uploads

Reference local files in your messages and they'll be automatically uploaded:

```
build a landing page like /path/to/screenshot.png
```

Supports: images (png, jpg, gif, webp, svg), documents (pdf, txt, csv, json), code files, and more.

### Environment Variables

| Variable | Default |
|----------|---------|
| `DREAMER_BACKEND_URL` | `https://dreamer-py.onrender.com` |
| `DREAMER_APP_URL` | `https://dreamer-py.vercel.app` |

## License

MIT
