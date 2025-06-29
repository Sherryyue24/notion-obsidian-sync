# Notion-Obsidian Sync Plugin

A powerful Obsidian plugin that synchronizes Notion databases to Obsidian folders with comprehensive field mapping and one-click sync capabilities.

**[中文文档](README-zh.md)** | **English Documentation**

---

## 🌟 Features

- **🔄 One-Click Sync**: Sync all enabled configurations with a single button
- **📊 Complete Field Mapping**: Support for all Notion property types including relations
- **🎯 Multiple Configurations**: Configure multiple database-folder sync pairs
- **⚡ Smart Property Conversion**: Automatic and custom field mapping options
- **🔗 Relation Field Support**: Fetch actual page titles from related databases
- **📝 Visual Configuration**: User-friendly setup with database and folder selection
- **🛡️ Error Handling**: Comprehensive error handling with detailed feedback
- **🌐 Network Optimization**: Uses Obsidian's native networking for better compatibility

## 🚀 Current Status

**✅ Fully Implemented: Notion → Obsidian Sync**
- Complete synchronization from Notion databases to Obsidian folders
- All Notion property types supported
- Field mapping configuration
- Multiple sync configurations

**🚧 Coming Soon:**
- Obsidian → Notion sync
- Bidirectional sync (Notion ↔ Obsidian)


## 🛠️ Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract files to `.obsidian/plugins/notion-obsidian-sync/` in your vault
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

### From Source

```bash
# Clone the repository
git clone https://github.com/Sherryyue24/notion-obsidian-sync.git
cd notion-obsidian-sync

# Install dependencies
npm install

# Build the plugin
npm run build
```

## ⚙️ Setup Guide

### 1. Get Notion API Token

1. Visit [Notion Developers](https://developers.notion.com/)
2. Create a new integration
3. Copy the "Internal Integration Token"
4. Share your databases with the integration:
   - Open your Notion database
   - Click "..." → "Add connections"
   - Select your integration

### 2. Configure the Plugin

1. Open Obsidian Settings → Community Plugins → Notion Sync
2. Enter your Notion API token
3. Click "Verify Token" to test the connection

### 3. Create Sync Configurations

**Quick Setup:**
1. Enter a configuration name
2. Select a Notion database from the dropdown
3. Choose an Obsidian folder
4. Click "Create Quick Sync"

**Advanced Setup:**
1. Click "Advanced Setup" for more options
2. Configure field mappings
3. Set sync preferences
4. Save configuration

## 🎮 Usage

### One-Click Sync All
- Click the "🔄 Sync All" button in settings
- All enabled configurations will sync automatically
- Real-time progress notifications

### Individual Sync
- Each configuration has its own "🔄 Sync" button
- Sync specific database-folder pairs
- View last sync time for each configuration

### Field Mapping Configuration
1. Select a database in configuration
2. Click "Configure Field Mappings"
3. Choose which Notion properties to sync
4. Map to corresponding Obsidian properties
5. Select appropriate data types

## 🔧 Advanced Features

### Smart Field Mapping
- Automatic property name suggestions
- Chinese to English name conversion
- Type-appropriate mapping recommendations

### Relation Field Support
- Fetches actual page titles instead of IDs
- Handles cross-database relations
- Requires proper integration permissions

### Error Handling
- Detailed error messages
- Network connectivity checks
- Permission issue guidance

## 📊 Sync Process

1. **Database Scan**: Retrieves all pages from Notion database
2. **Property Conversion**: Converts Notion properties to Obsidian frontmatter
3. **File Management**: Creates or updates Markdown files in target folder
4. **Timestamp Tracking**: Records sync times and modification dates
5. **Progress Feedback**: Shows real-time sync status

## 🚨 Troubleshooting

### Common Issues

**"Failed to fetch" Error:**
- Check internet connection
- Verify Notion API token
- Ensure database permissions

**Relation Fields Not Showing:**
- Grant integration access to related databases
- Check connection permissions in Notion

**Sync Failures:**
- Review error messages in notifications
- Check console logs for detailed information
- Verify folder permissions in Obsidian


## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

