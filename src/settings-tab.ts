import { App, PluginSettingTab, Setting, Notice, Plugin, TFolder, Modal } from 'obsidian';
import { SyncConfig, SyncDirection, SyncMode, FieldMapping } from './types';

// Need to import the plugin type - we'll define it as interface for now
interface NotionSyncPlugin extends Plugin {
  settings: {
    notionToken: string;
    autoSync: boolean;
    syncInterval: number;
    conflictResolution: string;
    syncConfigs: SyncConfig[];
  };
  saveSettings(): Promise<void>;
  setupAutoSync(): void;
  showConfigModal(): Promise<void>;
}

export class NotionSyncSettingTab extends PluginSettingTab {
    plugin: NotionSyncPlugin;
    private databases: any[] = [];
  
    constructor(app: App, plugin: NotionSyncPlugin) {
      super(app, plugin);
      this.plugin = plugin;
    }

    // Get all folders in the vault
    private getAllFolders(): string[] {
      const folders: string[] = [];
      const allFolders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];
      
      // Add root folder
      folders.push('/');
      
      // Add all other folders
      allFolders.forEach(folder => {
        folders.push(folder.path);
      });
      
      return folders.sort();
    }

    // Load available databases from Notion
    private async loadDatabases(): Promise<void> {
      if (!this.plugin.settings.notionToken) {
        this.databases = [];
        return;
      }

      try {
        const NotionAPI = (await import('./notion-api')).NotionAPI;
        const api = new NotionAPI(this.plugin.settings.notionToken);
        this.databases = await api.getDatabases();
      } catch (error) {
        console.error('Failed to load databases:', error);
        this.databases = [];
      }
    }

    // Show field mapping modal
    private async showFieldMappingModal(notionProperties: any, quickConfig?: any): Promise<void> {
      return new Promise((resolve) => {
        const modal = new FieldMappingModal(this.app, notionProperties, (mappings: FieldMapping[]) => {
          if (quickConfig) {
            quickConfig.fieldMappings = mappings;
          }
          new Notice(`Configured ${mappings.length} field mappings`);
          resolve();
        });
        modal.open();
      });
    }

    private async showEditConfigModal(config: SyncConfig): Promise<void> {
      return new Promise((resolve) => {
        const modal = new EditConfigModal(this.app, config, this.databases, this.plugin.settings.notionToken, (updatedConfig: SyncConfig) => {
          // Find and update the config in the array
          const index = this.plugin.settings.syncConfigs.findIndex(c => c.id === config.id);
          if (index !== -1) {
            this.plugin.settings.syncConfigs[index] = updatedConfig;
            this.plugin.saveSettings();
            this.display(); // Refresh the settings page
            new Notice(`Configuration "${updatedConfig.name}" updated!`);
          }
          resolve();
        });
        modal.open();
      });
    }
  
    display(): void {
      const { containerEl } = this;
      containerEl.empty();
  
      containerEl.createEl('h2', { text: 'Notion Sync Settings' });

      // Load databases if token is available
      if (this.plugin.settings.notionToken) {
        this.loadDatabases();
      }

      // Notion API Token
      new Setting(containerEl)
        .setName('Notion API Token')
        .setDesc('Your Notion integration token. Get it from https://developers.notion.com/')
        .addText(text => text
          .setPlaceholder('secret_...')
          .setValue(this.plugin.settings.notionToken)
          .onChange(async (value) => {
            this.plugin.settings.notionToken = value;
            await this.plugin.saveSettings();
          }))
        .addButton(btn => btn
          .setButtonText('Verify Token')
          .setTooltip('Test if your API token is valid')
          .onClick(async () => {
            if (!this.plugin.settings.notionToken) {
              new Notice('Please enter an API token first');
              return;
            }

            btn.setButtonText('Verifying...');
            btn.setDisabled(true);

            try {
              // Create a temporary NotionAPI instance to test the token
              const tempApi = new (await import('./notion-api')).NotionAPI(this.plugin.settings.notionToken);
              const result = await tempApi.validateToken();
              
              if (result.valid) {
                new Notice(`✅ ${result.message}`, 5000);
                btn.setButtonText('✅ Valid');
                setTimeout(() => btn.setButtonText('Verify Token'), 3000);
              } else {
                new Notice(`❌ ${result.message}`, 8000);
                btn.setButtonText('❌ Invalid');
                setTimeout(() => btn.setButtonText('Verify Token'), 3000);
              }
            } catch (error) {
              new Notice(`❌ Verification failed: ${error.message}`, 8000);
              btn.setButtonText('❌ Error');
              setTimeout(() => btn.setButtonText('Verify Token'), 3000);
            } finally {
              btn.setDisabled(false);
            }
          }));
  
      // Auto sync settings
      new Setting(containerEl)
        .setName('Enable Auto Sync')
        .setDesc('Automatically sync at regular intervals')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.setupAutoSync();
            }
          }));
  
      new Setting(containerEl)
        .setName('Sync Interval')
        .setDesc('How often to auto-sync (in minutes)')
        .addSlider(slider => slider
          .setLimits(5, 120, 5)
          .setValue(this.plugin.settings.syncInterval)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.syncInterval = value;
            await this.plugin.saveSettings();
            if (this.plugin.settings.autoSync) {
              this.plugin.setupAutoSync();
            }
          }));
  
      // Conflict resolution
      new Setting(containerEl)
        .setName('Conflict Resolution')
        .setDesc('How to handle conflicts when the same content is modified in both places')
        .addDropdown(dropdown => {
          dropdown.addOption('notion-wins', 'Notion Wins');
          dropdown.addOption('obsidian-wins', 'Obsidian Wins');
          dropdown.addOption('newer-wins', 'Newer Wins');
          dropdown.addOption('manual', 'Manual Resolution');
          dropdown.setValue(this.plugin.settings.conflictResolution);
          dropdown.onChange(async (value) => {
            this.plugin.settings.conflictResolution = value;
            await this.plugin.saveSettings();
          });
        });
  
            // Quick Setup Section (only show if no API token or no configs)
      if (!this.plugin.settings.notionToken || this.plugin.settings.syncConfigs.length === 0) {
        containerEl.createEl('h3', { text: 'Quick Setup' });
        
        if (!this.plugin.settings.notionToken) {
          containerEl.createEl('p', { 
            text: '⚠️ Please enter your Notion API token above first.',
            cls: 'setting-item-description'
          });
        } else if (this.plugin.settings.syncConfigs.length === 0) {
          containerEl.createEl('p', { 
            text: '🚀 Great! Now add your first sync configuration:',
            cls: 'setting-item-description'
          });
          
          // Quick config form
          let quickConfig = {
            name: '',
            notionDatabaseId: '',
            obsidianFolder: '',
            fieldMappings: [] as FieldMapping[]
          };
          
          new Setting(containerEl)
            .setName('Configuration Name')
            .setDesc('Give this sync a friendly name')
            .addText(text => text
              .setPlaceholder('My First Sync')
              .onChange(value => quickConfig.name = value));
          
          // Create database selection setting
          const databaseSetting = new Setting(containerEl)
            .setName('Notion Database')
            .setDesc('Select the Notion database to sync with');

          // Add dropdown for database selection
          databaseSetting.addDropdown(dropdown => {
            dropdown.addOption('', 'Select a database...');
            
            // Add databases to dropdown
            if (this.databases.length > 0) {
              this.databases.forEach(db => {
                // Extract title from Notion database object
                let title = 'Untitled Database';
                if (db.title && Array.isArray(db.title) && db.title.length > 0) {
                  title = db.title[0].plain_text || title;
                } else if (typeof db.title === 'string') {
                  title = db.title;
                }
                dropdown.addOption(db.id, title);
              });
            } else {
              dropdown.addOption('', 'No databases found - click Refresh');
            }
            
            dropdown.setValue(quickConfig.notionDatabaseId);
            dropdown.onChange(value => quickConfig.notionDatabaseId = value);
          });

          // Add refresh button
          databaseSetting.addButton(btn => btn
            .setButtonText('Refresh Databases')
            .setTooltip('Reload database list from Notion')
            .onClick(async () => {
              btn.setButtonText('Loading...');
              btn.setDisabled(true);
              
              try {
                await this.loadDatabases();
                this.display(); // Refresh the page to update dropdown
                new Notice('Database list refreshed');
              } catch (error) {
                new Notice(`Failed to refresh databases: ${error.message}`);
              } finally {
                btn.setDisabled(false);
              }
            }));

          // Add Configure Fields button
          databaseSetting.addButton(btn => btn
            .setButtonText('Configure Fields')
            .onClick(async () => {
              if (!quickConfig.notionDatabaseId) {
                new Notice('Please select a database first');
                return;
              }
              
              if (!this.plugin.settings.notionToken) {
                new Notice('Please enter your Notion API token first');
                return;
              }
              
              btn.setButtonText('Loading...');
              btn.setDisabled(true);
              
              try {
                const tempApi = new (await import('./notion-api')).NotionAPI(this.plugin.settings.notionToken);
                const properties = await tempApi.getDatabaseProperties(quickConfig.notionDatabaseId);
                
                // Show field mapping modal
                await this.showFieldMappingModal(properties, quickConfig);
                
              } catch (error) {
                new Notice(`❌ Failed to load database properties: ${error.message}`, 8000);
              } finally {
                btn.setButtonText('Configure Fields');
                btn.setDisabled(false);
              }
            }));
          
          new Setting(containerEl)
            .setName('Obsidian Folder')
            .setDesc('The folder to sync with (e.g., "Notes" or "Projects")')
            .addDropdown(dropdown => {
              const folders = this.getAllFolders();
              
              // Add all folders to dropdown
              folders.forEach(folder => {
                const displayName = folder === '/' ? 'Root (/)' : folder;
                dropdown.addOption(folder, displayName);
              });
              
              // Set default value
              dropdown.setValue(quickConfig.obsidianFolder || '/');
              
              dropdown.onChange(value => {
                quickConfig.obsidianFolder = value;
              });
            })
            .addButton(btn => btn
              .setButtonText('Refresh Folders')
              .setTooltip('Refresh the folder list')
              .onClick(() => {
                this.display(); // Refresh the entire settings page
              }));
          
          new Setting(containerEl)
            .addButton(btn => btn
              .setButtonText('Create Quick Sync')
              .setCta()
              .onClick(async () => {
                if (!quickConfig.name || !quickConfig.notionDatabaseId || !quickConfig.obsidianFolder) {
                  new Notice('Please fill in all fields');
                  return;
                }
                
                const config: SyncConfig = {
                  id: Date.now().toString(),
                  name: quickConfig.name,
                  obsidianFolder: quickConfig.obsidianFolder,
                  notionDatabaseId: quickConfig.notionDatabaseId,
                  syncDirection: SyncDirection.BIDIRECTIONAL,
                  syncMode: SyncMode.MANUAL,
                  fieldMappings: quickConfig.fieldMappings || [],
                  lastSync: 0,
                  enabled: true
                };
                
                this.plugin.settings.syncConfigs.push(config);
                await this.plugin.saveSettings();
                new Notice(`Configuration "${config.name}" created!`);
                this.display(); // Refresh the page
              }))
            .addButton(btn => btn
              .setButtonText('Advanced Setup')
              .onClick(async () => {
                await this.plugin.showConfigModal();
              }));
        }
      }

      // Sync configurations
      containerEl.createEl('h3', { text: 'Sync Configurations' });

      if (this.plugin.settings.syncConfigs.length === 0) {
        containerEl.createEl('p', { 
          text: 'No sync configurations yet.',
          cls: 'setting-item-description'
        });
      } else {
        for (let i = 0; i < this.plugin.settings.syncConfigs.length; i++) {
          const config = this.plugin.settings.syncConfigs[i];
          
          const configEl = containerEl.createDiv('notion-sync-config');
          
          new Setting(configEl)
            .setName(config.name)
            .setDesc(`${config.obsidianFolder} ↔ Notion Database (${config.syncDirection})`)
            .addToggle(toggle => toggle
              .setValue(config.enabled)
              .onChange(async (value) => {
                config.enabled = value;
                await this.plugin.saveSettings();
              }))
            .addButton(btn => btn
              .setButtonText('🔄 Sync')
              .setTooltip('Sync this configuration')
              .onClick(async () => {
                if (!this.plugin.settings.notionToken) {
                  new Notice('Please configure your Notion API token first');
                  return;
                }
                
                if (!config.enabled) {
                  new Notice('Please enable this configuration first');
                  return;
                }
                
                btn.setButtonText('Syncing...');
                btn.setDisabled(true);
                
                try {
                  // Get the syncManager from the plugin
                  const syncManager = (this.plugin as any).syncManager;
                  if (!syncManager) {
                    new Notice('Sync manager not available. Please restart the plugin.');
                    return;
                  }
                  
                  // Start sync for this specific configuration
                  await syncManager.syncConfig(config);
                  
                  // Update last sync time
                  config.lastSync = Date.now();
                  await this.plugin.saveSettings();
                  
                  new Notice(`✅ Successfully synced "${config.name}"`);
                  btn.setButtonText('✅ Synced');
                  
                  // Refresh the display to show updated last sync time
                  this.display();
                  
                  // Reset button text after 3 seconds
                  setTimeout(() => {
                    btn.setButtonText('🔄 Sync');
                  }, 3000);
                  
                } catch (error) {
                  new Notice(`❌ Sync failed for "${config.name}": ${error.message}`, 8000);
                  btn.setButtonText('❌ Failed');
                  console.error(`Sync failed for ${config.name}:`, error);
                  
                  // Reset button text after 3 seconds
                  setTimeout(() => {
                    btn.setButtonText('🔄 Sync');
                  }, 3000);
                } finally {
                  btn.setDisabled(false);
                }
              }))
            .addButton(btn => btn
              .setButtonText('Edit')
              .onClick(async () => {
                await this.showEditConfigModal(config);
              }))
            .addButton(btn => btn
              .setButtonText('Delete')
              .setWarning()
              .onClick(async () => {
                this.plugin.settings.syncConfigs.splice(i, 1);
                await this.plugin.saveSettings();
                this.display();
              }));
  
          // Show last sync time
          if (config.lastSync > 0) {
            configEl.createEl('div', {
              text: `Last synced: ${new Date(config.lastSync).toLocaleString()}`,
              cls: 'setting-item-description'
            });
          }
        }
      }
  
      // Sync and add configuration buttons
      new Setting(containerEl)
        .addButton(btn => btn
          .setButtonText('🔄 Sync All')
          .setTooltip('Sync all enabled configurations at once')
          .onClick(async () => {
            if (this.plugin.settings.syncConfigs.length === 0) {
              new Notice('No sync configurations found. Please add a configuration first.');
              return;
            }
            
            const enabledConfigs = this.plugin.settings.syncConfigs.filter(config => config.enabled);
            if (enabledConfigs.length === 0) {
              new Notice('No enabled sync configurations found. Please enable at least one configuration.');
              return;
            }
            
            // Get the syncManager from the plugin
            const syncManager = (this.plugin as any).syncManager;
            if (!syncManager) {
              new Notice('Sync manager not available. Please restart the plugin.');
              return;
            }
            
            // Start syncing all enabled configurations
            btn.setButtonText('Syncing...');
            btn.setDisabled(true);
            
            try {
              new Notice(`Starting sync for ${enabledConfigs.length} configuration(s)...`);
              
              let successCount = 0;
              let failCount = 0;
              
              for (const config of enabledConfigs) {
                try {
                  await syncManager.syncConfig(config);
                  config.lastSync = Date.now();
                  successCount++;
                  new Notice(`✅ ${config.name} synced successfully`);
                } catch (error) {
                  failCount++;
                  new Notice(`❌ ${config.name} sync failed: ${error.message}`, 8000);
                  console.error(`Sync failed for ${config.name}:`, error);
                }
              }
              
              // Save updated sync times
              await this.plugin.saveSettings();
              
              // Show final result
              if (failCount === 0) {
                new Notice(`🎉 All configurations synced successfully! (${successCount}/${enabledConfigs.length})`);
                btn.setButtonText('✅ Sync Complete');
              } else {
                new Notice(`⚠️ Sync completed with ${failCount} failure(s) (${successCount}/${enabledConfigs.length})`, 8000);
                btn.setButtonText('⚠️ Partial Success');
              }
              
              // Refresh the display to show updated sync times
              this.display();
              
              // Reset button text after 3 seconds
              setTimeout(() => {
                btn.setButtonText('🔄 Sync All');
              }, 3000);
              
            } catch (error) {
              new Notice(`❌ Sync operation failed: ${error.message}`, 8000);
              btn.setButtonText('❌ Sync Failed');
              console.error('Sync operation failed:', error);
              
              // Reset button text after 3 seconds
              setTimeout(() => {
                btn.setButtonText('🔄 Sync All');
              }, 3000);
            } finally {
              btn.setDisabled(false);
            }
          }))
        .addButton(btn => btn
          .setButtonText('Add Sync Configuration')
          .setCta()
          .onClick(async () => {
            await this.plugin.showConfigModal();
          }));
    }
  }

// Field Mapping Modal
export class FieldMappingModal extends Modal {
  private notionProperties: any;
  private onSave: (mappings: FieldMapping[]) => void;
  private mappings: FieldMapping[] = [];

  constructor(app: App, notionProperties: any, onSave: (mappings: FieldMapping[]) => void) {
    super(app);
    this.notionProperties = notionProperties;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Configure Field Mappings' });
    
    // Add relation fields permission notice (collapsible)
    const noticeEl = contentEl.createDiv('relation-permission-notice');
    
    // Create collapsible header
    const headerEl = noticeEl.createDiv('notice-header');
    const toggleIcon = headerEl.createEl('span', { text: '▶', cls: 'toggle-icon' });
    headerEl.createEl('span', { text: '💡 Important Notice About Relation Fields', cls: 'notice-title' });
    
    // Create collapsible content (initially hidden)
    const contentDiv = noticeEl.createDiv('notice-content');
    contentDiv.style.display = 'none';
    
    contentDiv.createEl('p', { 
      text: 'If your database contains Relation type fields but they don\'t appear in the list below, this is due to permission settings.'
    });
    
    const stepsEl = contentDiv.createEl('div');
    stepsEl.createEl('p', { text: 'To display Relation fields, ensure that:' });
    const stepsList = stepsEl.createEl('ol');
    stepsList.createEl('li', { text: 'Your Notion Integration has access to the main database' });
    stepsList.createEl('li', { text: 'Your Integration also needs access to the target databases that the Relation fields link to' });
    stepsList.createEl('li', { text: 'For each related database, click "..." → "Add connections" → select your Integration' });
    
    const linkEl = contentDiv.createEl('p');
    linkEl.createEl('span', { text: 'For more details, refer to: ' });
    linkEl.createEl('a', { 
      text: 'Notion API Official Documentation', 
      href: 'https://developers.notion.com/reference/property-object',
      attr: { target: '_blank' }
    });
    
    // Add click handler for toggling
    headerEl.addEventListener('click', () => {
      const isHidden = contentDiv.style.display === 'none';
      contentDiv.style.display = isHidden ? 'block' : 'none';
      toggleIcon.textContent = isHidden ? '▼' : '▶';
    });
    
    // Debug: log all properties
    console.log('All Notion properties:', this.notionProperties);
    console.log('Property types:', Object.entries(this.notionProperties).map(([name, info]) => 
      `${name}: ${(info as any).type}`
    ));
    
    // Debug: detailed property info
    Object.entries(this.notionProperties).forEach(([name, info]) => {
      console.log(`Property "${name}":`, info);
    });

    // Type mapping options - based on officially supported Obsidian property types
    const typeMappingOptions: Record<string, string[]> = {
      title:        ['text'],
      rich_text:    ['text'],
      number:       ['number', 'text'],
      select:       ['text', 'list'],
      multi_select: ['list', 'text'],
      status:       ['text', 'list'],
      checkbox:     ['checkbox'],
      date:         ['date', 'date & time', 'text'],
      url:          ['text'],
      email:        ['text'],
      phone_number: ['text'],
      people:       ['list', 'text'],
      files:        ['list', 'text'],
      relation:     ['list', 'text'],
      rollup:       ['number', 'text', 'list'],
      formula:      ['number', 'text', 'date'],
      created_time: ['date', 'date & time', 'text'],
      last_edited_time: ['date', 'date & time', 'text'],
      created_by:   ['text'],
      last_edited_by: ['text'],
      button:       ['text'],
      id:           ['text']
    };

    // Create table container
    const tableContainer = contentEl.createDiv('field-mapping-table-container');
    const table = tableContainer.createEl('table', { cls: 'field-mapping-table' });
    
    // Table header
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    headerRow.createEl('th', { text: 'Notion Property' });
    headerRow.createEl('th', { text: 'Type' });
    headerRow.createEl('th', { text: 'Obsidian Property' });
    headerRow.createEl('th', { text: 'Mapping Type' });
    headerRow.createEl('th', { text: 'Enable' });

    // Table body
    const tbody = table.createEl('tbody');
    
    for (const [propName, propInfo] of Object.entries(this.notionProperties)) {
      const propType = (propInfo as any).type;
      const row = tbody.createEl('tr');
      
      // Notion Property column
      row.createEl('td', { text: propName, cls: 'notion-property-name' });
      
      // Type column
      const typeCell = row.createEl('td');
      typeCell.createEl('code', { text: propType, cls: 'property-type-badge' });
      
      // Create mapping for this property
      const allowedTypes = typeMappingOptions[propType] || ['text'];
      const recommendedType = allowedTypes[0];
      // Default Obsidian property name is the same as Notion property name
      const mapping: FieldMapping = {
        notionProperty: propName,
        obsidianProperty: propName,
        type: recommendedType as any
      };

      // Obsidian Property column
      const obsidianCell = row.createEl('td');
      const obsidianInput = obsidianCell.createEl('input', {
        type: 'text',
        value: propName,
        cls: 'obsidian-property-input'
      });
      obsidianInput.addEventListener('input', (e) => {
        mapping.obsidianProperty = (e.target as HTMLInputElement).value;
        this.updateMapping(mapping);
      });

      // Mapping Type column
      const typeCell2 = row.createEl('td');
      const typeSelect = typeCell2.createEl('select', { cls: 'mapping-type-select' });
      allowedTypes.forEach(type => {
        const option = typeSelect.createEl('option', { 
          value: type, 
          text: type.charAt(0).toUpperCase() + type.slice(1)
        });
        if (type === recommendedType) option.selected = true;
      });
      typeSelect.addEventListener('change', (e) => {
        mapping.type = (e.target as HTMLSelectElement).value as any;
        this.updateMapping(mapping);
      });

      // Enable column
      const enableCell = row.createEl('td');
      const enableCheckbox = enableCell.createEl('input', { 
        type: 'checkbox',
        cls: 'enable-checkbox'
      });
      enableCheckbox.checked = true;
      enableCheckbox.addEventListener('change', (e) => {
        const enabled = (e.target as HTMLInputElement).checked;
        if (enabled) {
          this.updateMapping(mapping);
        } else {
          this.removeMapping(mapping.notionProperty);
        }
      });

      // Add this mapping initially
      this.updateMapping(mapping);
    }

    // Buttons
    const buttonContainer = contentEl.createDiv('modal-button-container');
    
    const saveButton = buttonContainer.createEl('button', { 
      text: 'Save Mappings',
      cls: 'mod-cta'
    });
    saveButton.onclick = () => {
      this.onSave(this.mappings);
      this.close();
    };

    const cancelButton = buttonContainer.createEl('button', { 
      text: 'Cancel'
    });
    cancelButton.onclick = () => {
      this.close();
    };

    // Add table styling
    contentEl.createEl('style', {
      text: `
        .relation-permission-notice {
          background: var(--background-secondary);
          border: 1px solid var(--background-modifier-border);
          border-radius: 8px;
          margin: 16px 0;
          border-left: 4px solid var(--interactive-accent);
        }
        .notice-header {
          padding: 12px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          user-select: none;
        }
        .notice-header:hover {
          background: var(--background-modifier-hover);
        }
        .toggle-icon {
          font-size: 12px;
          color: var(--text-muted);
          transition: transform 0.2s ease;
        }
        .notice-title {
          color: var(--interactive-accent);
          font-size: 16px;
          font-weight: 600;
        }
        .notice-content {
          padding: 0 16px 16px 16px;
        }
        .notice-content p {
          margin: 8px 0;
          color: var(--text-muted);
          line-height: 1.5;
        }
        .notice-content ol {
          margin: 8px 0 8px 20px;
          color: var(--text-muted);
        }
        .notice-content li {
          margin: 4px 0;
          line-height: 1.4;
        }
        .notice-content a {
          color: var(--interactive-accent);
          text-decoration: none;
        }
        .notice-content a:hover {
          text-decoration: underline;
        }
        .field-mapping-table-container {
          max-height: 500px;
          overflow-y: auto;
          margin: 20px 0;
          border: 1px solid var(--background-modifier-border);
          border-radius: 8px;
        }
        .field-mapping-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        .field-mapping-table th {
          background: var(--background-secondary);
          padding: 12px 8px;
          border-bottom: 2px solid var(--background-modifier-border);
          text-align: left;
          font-weight: 600;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .field-mapping-table td {
          padding: 8px;
          border-bottom: 1px solid var(--background-modifier-border-focus);
          vertical-align: middle;
        }
        .field-mapping-table tr:hover {
          background: var(--background-modifier-hover);
        }
        .notion-property-name {
          font-weight: 500;
          max-width: 150px;
          word-wrap: break-word;
        }
        .property-type-badge {
          background: var(--tag-background);
          color: var(--tag-color);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
          font-family: var(--font-monospace);
        }
        .obsidian-property-input {
          width: 100%;
          max-width: 120px;
          padding: 4px 6px;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          background: var(--background-primary);
          color: var(--text-normal);
          font-size: 13px;
        }
        .obsidian-property-input:focus {
          outline: none;
          border-color: var(--interactive-accent);
        }
        .mapping-type-select {
          width: 100%;
          max-width: 100px;
          padding: 4px;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          background: var(--background-primary);
          color: var(--text-normal);
          font-size: 13px;
        }
        .mapping-type-select:focus {
          outline: none;
          border-color: var(--interactive-accent);
        }
        .enable-checkbox {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        .modal-button-container {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          margin-top: 20px;
          padding-top: 15px;
          border-top: 1px solid var(--background-modifier-border);
        }
      `
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private updateMapping(mapping: FieldMapping) {
    // Remove existing mapping for this property
    this.mappings = this.mappings.filter(m => m.notionProperty !== mapping.notionProperty);
    
    // Add new mapping if obsidian property is specified
    if (mapping.obsidianProperty.trim()) {
      this.mappings.push({
        notionProperty: mapping.notionProperty,
        obsidianProperty: mapping.obsidianProperty.trim(),
        type: mapping.type
      });
    }
  }

  private removeMapping(notionProperty: string) {
    this.mappings = this.mappings.filter(m => m.notionProperty !== notionProperty);
  }

  private suggestObsidianProperty(notionProperty: string): string {
    // Common Chinese to English property name mappings
    const chineseToEnglishMap: Record<string, string> = {
      'position_type': 'position_type',
      'work_mode': 'work_mode', 
      'evaluation': 'evaluation',
      'publish_date': 'publish_date',
      'work_location': 'work_location',
      'application_channel': 'application_channel',
      'german_requirement': 'german_requirement',
      'collection_time': 'collection_time',
      'title': 'title',
      'name': 'name',
      'status': 'status',
      'created_time': 'created_time',
      'modified_time': 'modified_time',
      'tags': 'tags',
      'category': 'category',
      'type': 'type',
      'description': 'description',
      'notes': 'notes'
    };

    // Check if it's a common Chinese property
    if (chineseToEnglishMap[notionProperty]) {
      return chineseToEnglishMap[notionProperty];
    }

    // Convert Notion property name to a good Obsidian property name
    return notionProperty
      .toLowerCase()
      .replace(/\s+/g, '_')           // Replace spaces with underscores
      .replace(/[^\w\u4e00-\u9fff_]/g, '') // Keep letters, numbers, Chinese characters, and underscores
      .replace(/[\u4e00-\u9fff]/g, match => {
        // For Chinese characters, try to transliterate or keep as is
        return match;
      })
      .substring(0, 30);              // Limit length to 30 characters
  }

  private mapNotionTypeToMappingType(notionType: string): 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'date & time' {
    const typeMap: { [key: string]: 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'date & time' } = {
      'title': 'text',
      'rich_text': 'text',
      'number': 'number',
      'date': 'date',
      'select': 'text',
      'multi_select': 'list',
      'checkbox': 'checkbox',
      'url': 'text',
      'email': 'text',
      'phone_number': 'text',
      'status': 'text',
      'people': 'list',
      'files': 'list',
      'relation': 'list',
      'formula': 'text',
      'rollup': 'text',
      'created_time': 'date',
      'last_edited_time': 'date',
      'created_by': 'text',
      'last_edited_by': 'text'
    };

    return typeMap[notionType] || 'text';
  }
}

// Edit Configuration Modal
export class EditConfigModal extends Modal {
  private config: SyncConfig;
  private databases: any[];
  private notionToken: string;
  private onSave: (config: SyncConfig) => void;
  private tempConfig: SyncConfig;

  constructor(app: App, config: SyncConfig, databases: any[], notionToken: string, onSave: (config: SyncConfig) => void) {
    super(app);
    this.config = config;
    this.databases = databases;
    this.notionToken = notionToken;
    this.onSave = onSave;
    // Create a copy to edit
    this.tempConfig = JSON.parse(JSON.stringify(config));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Edit Sync Configuration' });

    // Configuration Name
    new Setting(contentEl)
      .setName('Configuration Name')
      .setDesc('A friendly name for this sync configuration')
      .addText(text => text
        .setPlaceholder('My Sync Configuration')
        .setValue(this.tempConfig.name)
        .onChange(value => {
          this.tempConfig.name = value;
        }));

    // Notion Database Selection
    const databaseSetting = new Setting(contentEl)
      .setName('Notion Database')
      .setDesc('Select the Notion database to sync with');

    databaseSetting.addDropdown(dropdown => {
      dropdown.addOption('', 'Select a database...');
      
      if (this.databases.length > 0) {
        this.databases.forEach(db => {
          let title = 'Untitled Database';
          if (db.title && Array.isArray(db.title) && db.title.length > 0) {
            title = db.title[0].plain_text || title;
          } else if (typeof db.title === 'string') {
            title = db.title;
          }
          dropdown.addOption(db.id, title);
        });
      } else {
        dropdown.addOption('', 'No databases found');
      }
      
      dropdown.setValue(this.tempConfig.notionDatabaseId);
      dropdown.onChange(value => {
        this.tempConfig.notionDatabaseId = value;
      });
    });

    // Obsidian Folder Selection
    const folderSetting = new Setting(contentEl)
      .setName('Obsidian Folder')
      .setDesc('Select the Obsidian folder to sync with');

    const folders = this.getAllFolders();
    folderSetting.addDropdown(dropdown => {
      dropdown.addOption('', 'Root folder');
      folders.forEach(folder => {
        dropdown.addOption(folder, folder);
      });
      dropdown.setValue(this.tempConfig.obsidianFolder);
      dropdown.onChange(value => {
        this.tempConfig.obsidianFolder = value;
      });
    });

    // Sync Direction
    new Setting(contentEl)
      .setName('Sync Direction')
      .setDesc('Choose how to sync between Notion and Obsidian')
      .addDropdown(dropdown => {
        dropdown.addOption(SyncDirection.BIDIRECTIONAL, 'Bidirectional (Both ways)');
        dropdown.addOption(SyncDirection.NOTION_TO_OBSIDIAN, 'Notion → Obsidian');
        dropdown.addOption(SyncDirection.OBSIDIAN_TO_NOTION, 'Obsidian → Notion');
        dropdown.setValue(this.tempConfig.syncDirection);
        dropdown.onChange(value => {
          const selectedDirection = value as SyncDirection;
          
          // Show "under development" notice for non-supported directions
          if (selectedDirection === SyncDirection.BIDIRECTIONAL) {
            new Notice('⚠️ Bidirectional sync is under development. Please use "Notion → Obsidian" for now.', 5000);
            // Reset to supported option
            dropdown.setValue(SyncDirection.NOTION_TO_OBSIDIAN);
            this.tempConfig.syncDirection = SyncDirection.NOTION_TO_OBSIDIAN;
            return;
          } else if (selectedDirection === SyncDirection.OBSIDIAN_TO_NOTION) {
            new Notice('⚠️ Obsidian → Notion sync is under development. Please use "Notion → Obsidian" for now.', 5000);
            // Reset to supported option
            dropdown.setValue(SyncDirection.NOTION_TO_OBSIDIAN);
            this.tempConfig.syncDirection = SyncDirection.NOTION_TO_OBSIDIAN;
            return;
          }
          
          this.tempConfig.syncDirection = selectedDirection;
        });
      });

    // Sync Mode
    new Setting(contentEl)
      .setName('Sync Mode')
      .setDesc('Choose when to sync')
      .addDropdown(dropdown => {
        dropdown.addOption(SyncMode.MANUAL, 'Manual');
        dropdown.addOption(SyncMode.AUTO, 'Automatic');
        dropdown.setValue(this.tempConfig.syncMode);
        dropdown.onChange(value => {
          this.tempConfig.syncMode = value as SyncMode;
        });
      });

    // Enabled Toggle
    new Setting(contentEl)
      .setName('Enabled')
      .setDesc('Whether this sync configuration is active')
      .addToggle(toggle => toggle
        .setValue(this.tempConfig.enabled)
        .onChange(value => {
          this.tempConfig.enabled = value;
        }));

    // Field Mappings Section
    const fieldMappingsEl = contentEl.createDiv('field-mappings-section');
    fieldMappingsEl.createEl('h3', { text: 'Field Mappings' });
    
    if (this.tempConfig.fieldMappings && this.tempConfig.fieldMappings.length > 0) {
      const mappingsList = fieldMappingsEl.createEl('div', { cls: 'field-mappings-list' });
      this.tempConfig.fieldMappings.forEach((mapping, index) => {
        const mappingEl = mappingsList.createDiv('field-mapping-item');
        mappingEl.createEl('span', { text: `${mapping.notionProperty} → ${mapping.obsidianProperty} (${mapping.type})` });
      });
    } else {
      fieldMappingsEl.createEl('p', { 
        text: 'No field mappings configured.',
        cls: 'setting-item-description'
      });
    }

    // Configure Fields Button
    new Setting(fieldMappingsEl)
      .addButton(btn => btn
        .setButtonText('Configure Field Mappings')
        .onClick(async () => {
          if (!this.tempConfig.notionDatabaseId) {
            new Notice('Please select a database first');
            return;
          }
          
          try {
            const tempApi = new (await import('./notion-api')).NotionAPI(this.notionToken);
            const properties = await tempApi.getDatabaseProperties(this.tempConfig.notionDatabaseId);
            
            await this.showFieldMappingModal(properties);
          } catch (error) {
            new Notice(`Failed to load database properties: ${error.message}`);
          }
        }));

    // Buttons
    const buttonContainer = contentEl.createDiv('modal-button-container');
    
    const saveButton = buttonContainer.createEl('button', { 
      text: 'Save Changes',
      cls: 'mod-cta'
    });
    saveButton.onclick = () => {
      if (!this.tempConfig.name || !this.tempConfig.notionDatabaseId || !this.tempConfig.obsidianFolder) {
        new Notice('Please fill in all required fields');
        return;
      }
      
      this.onSave(this.tempConfig);
      this.close();
    };

    const cancelButton = buttonContainer.createEl('button', { 
      text: 'Cancel'
    });
    cancelButton.onclick = () => {
      this.close();
    };

    // Add styling
    contentEl.createEl('style', {
      text: `
        .field-mappings-section {
          margin: 20px 0;
          padding: 16px;
          background: var(--background-secondary);
          border-radius: 8px;
        }
        .field-mappings-list {
          margin: 10px 0;
        }
        .field-mapping-item {
          padding: 8px;
          margin: 4px 0;
          background: var(--background-primary);
          border-radius: 4px;
          font-family: var(--font-monospace);
          font-size: 13px;
        }
        .modal-button-container {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          margin-top: 20px;
          padding-top: 15px;
          border-top: 1px solid var(--background-modifier-border);
        }
      `
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private getAllFolders(): string[] {
    const folders: string[] = [];
    const files = this.app.vault.getAllLoadedFiles();
    
    files.forEach(file => {
      if (file instanceof TFolder) {
        folders.push(file.path);
      }
    });
    
    return folders.sort();
  }

  private async showFieldMappingModal(notionProperties: any): Promise<void> {
    return new Promise((resolve) => {
      const modal = new FieldMappingModal(this.app, notionProperties, (mappings: FieldMapping[]) => {
        this.tempConfig.fieldMappings = mappings;
        new Notice(`Configured ${mappings.length} field mappings`);
        // Refresh the modal display to show updated mappings
        this.onOpen();
        resolve();
      });
      modal.open();
    });
  }
}
  