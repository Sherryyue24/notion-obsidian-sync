import { App, Modal, Setting, Notice, TFolder, FuzzySuggestModal } from 'obsidian';
import { NotionAPI } from './notion-api';
import { SyncManager } from './sync-manager';
import { SyncConfig, SyncDirection, SyncMode, FieldMapping } from './types';

export class SyncModal extends Modal {
  private selectedConfigs: Set<string> = new Set();

  constructor(
    app: App,
    private syncManager: SyncManager,
    private syncConfigs: SyncConfig[]
  ) {
    super(app);
    // Initially select all enabled configs
    this.syncConfigs.forEach(config => {
      if (config.enabled) {
        this.selectedConfigs.add(config.id);
      }
    });
  }

  onOpen() {
    const { contentEl } = this;
    this.buildModal();
  }

  private buildModal() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: 'Select Configurations to Sync' });

    if (this.syncConfigs.length === 0) {
      contentEl.createEl('p', { text: 'No sync configurations found. Please add a configuration first.' });
      
      new Setting(contentEl)
        .addButton(btn => btn
          .setButtonText('Close')
          .onClick(() => this.close()));
      return;
    }

    // Filter enabled configs
    const enabledConfigs = this.syncConfigs.filter(config => config.enabled);
    
    if (enabledConfigs.length === 0) {
      contentEl.createEl('p', { text: 'No enabled sync configurations found. Please enable at least one configuration in settings.' });
      
      new Setting(contentEl)
        .addButton(btn => btn
          .setButtonText('Close')
          .onClick(() => this.close()));
      return;
    }

    // Select All / Deselect All controls
    new Setting(contentEl)
      .setName('Batch Selection')
      .setDesc('Quickly select or deselect all configurations')
      .addButton(btn => btn
        .setButtonText('Select All')
        .onClick(() => {
          enabledConfigs.forEach(config => this.selectedConfigs.add(config.id));
          this.buildModal(); // Refresh to update checkboxes
        }))
      .addButton(btn => btn
        .setButtonText('Deselect All')
        .onClick(() => {
          this.selectedConfigs.clear();
          this.buildModal(); // Refresh to update checkboxes
        }));

    // Configuration selection section
    contentEl.createEl('h3', { text: 'Available Configurations' });
    
    const configContainer = contentEl.createDiv('sync-config-selection');

    for (const config of enabledConfigs) {
      const configEl = configContainer.createDiv('sync-config-item');
      
      // Add checkbox and config info
      new Setting(configEl)
        .setName(config.name)
        .setDesc(`${config.obsidianFolder} ↔ Notion Database (${config.syncDirection})`)
        .addToggle(toggle => toggle
          .setValue(this.selectedConfigs.has(config.id))
          .onChange(value => {
            if (value) {
              this.selectedConfigs.add(config.id);
            } else {
              this.selectedConfigs.delete(config.id);
            }
          }))
        .addExtraButton(btn => btn
          .setIcon('info')
          .setTooltip('Show sync details')
          .onClick(() => {
            const lastSync = config.lastSync > 0 ? new Date(config.lastSync).toLocaleString() : 'Never';
            new Notice(`Last sync: ${lastSync}\nField mappings: ${config.fieldMappings?.length || 0}`, 5000);
          }));

      // Show last sync time
      if (config.lastSync > 0) {
        configEl.createEl('div', {
          text: `Last synced: ${new Date(config.lastSync).toLocaleString()}`,
          cls: 'setting-item-description sync-last-time'
        });
      }
    }

    // Sync direction selection
    contentEl.createEl('h3', { text: 'Sync Options' });
    
    let selectedDirection: SyncDirection | undefined = undefined;
    
    new Setting(contentEl)
      .setName('Sync Direction')
      .setDesc('Choose how to sync the selected configurations')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'Use each config\'s default direction');
        dropdown.addOption(SyncDirection.BIDIRECTIONAL, 'Bidirectional (Both ways)');
        dropdown.addOption(SyncDirection.NOTION_TO_OBSIDIAN, 'Notion → Obsidian');
        dropdown.addOption(SyncDirection.OBSIDIAN_TO_NOTION, 'Obsidian → Notion');
        dropdown.onChange(value => {
          if (value === SyncDirection.BIDIRECTIONAL) {
            new Notice('⚠️ Bidirectional sync is under development. Please use "Notion → Obsidian" for now.', 5000);
            dropdown.setValue('');
            selectedDirection = undefined;
            return;
          } else if (value === SyncDirection.OBSIDIAN_TO_NOTION) {
            new Notice('⚠️ Obsidian → Notion sync is under development. Please use "Notion → Obsidian" for now.', 5000);
            dropdown.setValue('');
            selectedDirection = undefined;
            return;
          }
          selectedDirection = value as SyncDirection || undefined;
        });
      });

    // Action buttons
    const buttonContainer = contentEl.createDiv('sync-modal-buttons');
    
    // Sync selected button
    const syncButton = buttonContainer.createEl('button', {
      text: `Sync Selected (${this.selectedConfigs.size})`,
      cls: 'mod-cta'
    });
    syncButton.onclick = async () => {
      if (this.selectedConfigs.size === 0) {
        new Notice('Please select at least one configuration to sync');
        return;
      }
      
      syncButton.textContent = 'Syncing...';
      syncButton.disabled = true;
      
      try {
        const selectedConfigObjects = enabledConfigs.filter(config => 
          this.selectedConfigs.has(config.id)
        );
        
        new Notice(`Starting sync for ${selectedConfigObjects.length} configuration(s)...`);
        
        for (const config of selectedConfigObjects) {
          try {
            await this.syncManager.syncConfig(config, selectedDirection);
            new Notice(`✅ Synced: ${config.name}`);
          } catch (error) {
            new Notice(`❌ Failed to sync ${config.name}: ${error.message}`, 8000);
            console.error(`Sync failed for ${config.name}:`, error);
          }
        }
        
        new Notice(`🎉 Completed sync for ${selectedConfigObjects.length} configuration(s)`);
        this.close();
      } catch (error) {
        new Notice(`❌ Sync operation failed: ${error.message}`, 8000);
        console.error('Sync operation failed:', error);
      } finally {
        syncButton.disabled = false;
        syncButton.textContent = `Sync Selected (${this.selectedConfigs.size})`;
      }
    };

    // Quick sync all button
    const syncAllButton = buttonContainer.createEl('button', {
      text: 'Sync All Enabled'
    });
    syncAllButton.onclick = async () => {
      syncAllButton.textContent = 'Syncing All...';
      syncAllButton.disabled = true;
      
      try {
        await this.syncManager.syncAll(selectedDirection);
        new Notice('✅ All configurations synced successfully');
        this.close();
      } catch (error) {
        new Notice(`❌ Sync all failed: ${error.message}`, 8000);
        console.error('Sync all failed:', error);
      } finally {
        syncAllButton.disabled = false;
        syncAllButton.textContent = 'Sync All Enabled';
      }
    };

    // Cancel button
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel'
    });
    cancelButton.onclick = () => this.close();

    // Add styling
    contentEl.createEl('style', {
      text: `
        .sync-config-selection {
          max-height: 400px;
          overflow-y: auto;
          margin: 10px 0;
          padding: 10px;
          background: var(--background-secondary);
          border-radius: 8px;
        }
        .sync-config-item {
          margin: 8px 0;
          padding: 12px;
          background: var(--background-primary);
          border-radius: 6px;
          border: 1px solid var(--background-modifier-border);
        }
        .sync-config-item:hover {
          background: var(--background-modifier-hover);
        }
        .sync-last-time {
          margin-top: 4px;
          font-size: 12px;
          color: var(--text-muted);
        }
        .sync-modal-buttons {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          margin-top: 20px;
          padding-top: 15px;
          border-top: 1px solid var(--background-modifier-border);
        }
        .sync-modal-buttons button {
          padding: 8px 16px;
          border-radius: 4px;
          border: 1px solid var(--background-modifier-border);
          background: var(--interactive-normal);
          color: var(--text-normal);
          cursor: pointer;
        }
        .sync-modal-buttons button:hover {
          background: var(--interactive-hover);
        }
        .sync-modal-buttons button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .sync-modal-buttons .mod-cta {
          background: var(--interactive-accent);
          color: var(--text-on-accent);
          border-color: var(--interactive-accent);
        }
      `
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class ConfigModal extends Modal {
  private config: Partial<SyncConfig> = {
    id: '',
    name: '',
    obsidianFolder: '',
    notionDatabaseId: '',
    syncDirection: SyncDirection.NOTION_TO_OBSIDIAN,
    syncMode: SyncMode.MANUAL,
    fieldMappings: [],
    lastSync: 0,
    enabled: true
  };
  private databases: any[] = [];
  private databaseProperties: any[] = [];

  constructor(
    app: App,
    private notionApi: NotionAPI,
    private onSave: (config: SyncConfig) => void
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Add Sync Configuration' });

    // Load databases
    try {
      this.databases = await this.notionApi.getDatabases();
    } catch (error) {
      new Notice('Failed to load Notion databases. Check your API token.');
      this.close();
      return;
    }

    this.buildForm();
  }

  private buildForm() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Add Sync Configuration' });

    // Configuration name
    new Setting(contentEl)
      .setName('Configuration Name')
      .setDesc('A friendly name for this sync configuration')
      .addText(text => text
        .setPlaceholder('My Notion Sync')
        .setValue(this.config.name || '')
        .onChange(value => this.config.name = value));

    // Obsidian folder selection
    new Setting(contentEl)
      .setName('Obsidian Folder')
      .setDesc('Select the folder to sync with Notion')
      .addDropdown(dropdown => {
        // Get all folders
        const folders: string[] = [];
        const allFolders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];
        
        // Add root folder
        folders.push('/');
        
        // Add all other folders
        allFolders.forEach(folder => {
          folders.push(folder.path);
        });
        
        folders.sort();
        
        // Add all folders to dropdown
        folders.forEach(folder => {
          const displayName = folder === '/' ? 'Root (/)' : folder;
          dropdown.addOption(folder, displayName);
        });
        
        // Set current value
        dropdown.setValue(this.config.obsidianFolder || '/');
        
        dropdown.onChange(value => {
          this.config.obsidianFolder = value;
        });
      });

    // Notion database selection
    new Setting(contentEl)
      .setName('Notion Database')
      .setDesc('Select the Notion database to sync')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'Select a database...');
        for (const db of this.databases) {
          // Extract title from Notion database object
          let title = 'Untitled Database';
          if (db.title && Array.isArray(db.title) && db.title.length > 0) {
            title = db.title[0].plain_text || title;
          } else if (typeof db.title === 'string') {
            title = db.title;
          }
          dropdown.addOption(db.id, title);
        }
        dropdown.setValue(this.config.notionDatabaseId || '');
        dropdown.onChange(async (value) => {
          this.config.notionDatabaseId = value;
          if (value) {
            await this.loadDatabaseProperties(value);
            this.buildForm();
          }
        });
      })
      .addButton(btn => btn
        .setButtonText('Configure Fields')
        .setTooltip('Configure field mappings for this database')
        .onClick(async () => {
          if (!this.config.notionDatabaseId) {
            new Notice('Please select a database first');
            return;
          }
          
          btn.setButtonText('Loading...');
          btn.setDisabled(true);
          
          try {
            const properties = await this.notionApi.getDatabaseProperties(this.config.notionDatabaseId);
            
            // Import and show field mapping modal
            const { FieldMappingModal } = await import('./settings-tab');
            const modal = new FieldMappingModal(this.app, properties, (mappings) => {
              this.config.fieldMappings = mappings;
              new Notice(`Configured ${mappings.length} field mappings`);
            });
            modal.open();
            
          } catch (error) {
            new Notice(`❌ Failed to load database properties: ${error.message}`, 8000);
          } finally {
            btn.setButtonText('Configure Fields');
            btn.setDisabled(false);
          }
        }));

    // Sync direction
    new Setting(contentEl)
      .setName('Sync Direction')
      .setDesc('Choose how data should be synchronized')
      .addDropdown(dropdown => {
        dropdown.addOption(SyncDirection.BIDIRECTIONAL, 'Bidirectional (Both ways)');
        dropdown.addOption(SyncDirection.NOTION_TO_OBSIDIAN, 'Notion → Obsidian');
        dropdown.addOption(SyncDirection.OBSIDIAN_TO_NOTION, 'Obsidian → Notion');
        dropdown.setValue(this.config.syncDirection || SyncDirection.NOTION_TO_OBSIDIAN);
        dropdown.onChange(value => {
          const selectedDirection = value as SyncDirection;
          
          if (selectedDirection === SyncDirection.BIDIRECTIONAL) {
            new Notice('⚠️ Bidirectional sync is under development. Please use "Notion → Obsidian" for now.', 5000);
            dropdown.setValue(SyncDirection.NOTION_TO_OBSIDIAN);
            this.config.syncDirection = SyncDirection.NOTION_TO_OBSIDIAN;
            return;
          } else if (selectedDirection === SyncDirection.OBSIDIAN_TO_NOTION) {
            new Notice('⚠️ Obsidian → Notion sync is under development. Please use "Notion → Obsidian" for now.', 5000);
            dropdown.setValue(SyncDirection.NOTION_TO_OBSIDIAN);
            this.config.syncDirection = SyncDirection.NOTION_TO_OBSIDIAN;
            return;
          }
          
          this.config.syncDirection = selectedDirection;
        });
      });

    // Sync mode
    new Setting(contentEl)
      .setName('Sync Mode')
      .setDesc('When should this configuration be synced')
      .addDropdown(dropdown => {
        dropdown.addOption(SyncMode.MANUAL, 'Manual only');
        dropdown.addOption(SyncMode.AUTO, 'Auto (with global sync)');
        dropdown.addOption(SyncMode.SCHEDULED, 'Scheduled');
        dropdown.setValue(this.config.syncMode || SyncMode.MANUAL);
        dropdown.onChange(value => this.config.syncMode = value as SyncMode);
      });

    // Field mappings section
    if (this.databaseProperties.length > 0) {
      contentEl.createEl('h3', { text: 'Field Mappings' });
      contentEl.createEl('p', { 
        text: 'Map Notion database properties to Obsidian frontmatter fields',
        cls: 'setting-item-description'
      });

      this.buildFieldMappings(contentEl);

      // Add mapping button
      new Setting(contentEl)
        .addButton(btn => btn
          .setButtonText('Add Field Mapping')
          .onClick(() => {
            this.config.fieldMappings!.push({
              notionProperty: '',
              obsidianProperty: '',
              type: 'text'
            });
            this.buildForm();
          }));
    }

    // Save button
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Save Configuration')
        .setCta()
        .onClick(() => this.saveConfig()));

    // Cancel button
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()));
  }

  private buildFieldMappings(containerEl: HTMLElement) {
    if (!this.config.fieldMappings) this.config.fieldMappings = [];

    for (let i = 0; i < this.config.fieldMappings.length; i++) {
      const mapping = this.config.fieldMappings[i];
      const setting = new Setting(containerEl)
        .setName(`Mapping ${i + 1}`)
        .addDropdown(dropdown => {
          dropdown.addOption('', 'Select Notion property...');
          for (const prop of this.databaseProperties) {
            dropdown.addOption(prop.name, `${prop.name} (${prop.type})`);
          }
          dropdown.setValue(mapping.notionProperty);
          dropdown.onChange(value => {
            mapping.notionProperty = value;
            const prop = this.databaseProperties.find(p => p.name === value);
            if (prop) {
              mapping.type = this.mapNotionTypeToFieldType(prop.type);
            }
          });
        })
        .addText(text => text
          .setPlaceholder('Obsidian property name')
          .setValue(mapping.obsidianProperty)
          .onChange(value => mapping.obsidianProperty = value))
        .addButton(btn => btn
          .setButtonText('Remove')
          .setWarning()
          .onClick(() => {
            this.config.fieldMappings!.splice(i, 1);
            this.buildForm();
          }));
    }
  }

  private async loadDatabaseProperties(databaseId: string) {
    try {
      const properties = await this.notionApi.getDatabaseProperties(databaseId);
      this.databaseProperties = Object.entries(properties).map(([name, prop]: [string, any]) => ({
        name,
        type: prop.type
      }));
    } catch (error) {
      new Notice('Failed to load database properties');
      console.error(error);
    }
  }

  private mapNotionTypeToFieldType(notionType: string): FieldMapping['type'] {
    const typeMap: Record<string, FieldMapping['type']> = {
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
      'relation': 'list'
    };
    
    return typeMap[notionType] || 'text';
  }

  private saveConfig() {
    if (!this.config.name) {
      new Notice('Please enter a configuration name');
      return;
    }

    if (!this.config.obsidianFolder) {
      new Notice('Please select an Obsidian folder');
      return;
    }

    if (!this.config.notionDatabaseId) {
      new Notice('Please select a Notion database');
      return;
    }

    // Generate ID if not exists
    if (!this.config.id) {
      this.config.id = Date.now().toString();
    }

    this.onSave(this.config as SyncConfig);
    new Notice(`Configuration "${this.config.name}" saved!`);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private onSelect: (folder: TFolder) => void
  ) {
    super(app);
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const addFolders = (folder: TFolder) => {
      folders.push(folder);
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          addFolders(child);
        }
      }
    };

    const rootFolder = this.app.vault.getRoot();
    addFolders(rootFolder);
    return folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || '/';
  }

  onChooseItem(folder: TFolder): void {
    this.onSelect(folder);
  }
} 