import { Plugin, TFolder, Notice, Modal, Setting, PluginSettingTab, App } from 'obsidian';
import { NotionAPI } from './src/notion-api';
import { SyncManager } from './src/sync-manager';
import { SyncConfig, SyncMode, SyncDirection, NotionSyncSettings } from './src/types';
import { NotionSyncSettingTab } from './src/settings-tab';

const DEFAULT_SETTINGS: NotionSyncSettings = {
  notionToken: '',
  syncConfigs: [],
  defaultSyncMode: SyncMode.MANUAL,
  syncInterval: 30,
  autoSync: false,
  conflictResolution: 'newer-wins'
}

export default class NotionSyncPlugin extends Plugin {
  settings: NotionSyncSettings;
  syncManager: SyncManager;
  notionApi: NotionAPI;
  syncInterval: number;
  settingsTab: NotionSyncSettingTab;

  async onload() {
    await this.loadSettings();
    
    this.notionApi = new NotionAPI(this.settings.notionToken);
    this.syncManager = new SyncManager(this.app, this.notionApi, this.settings);

    // Add ribbon icon
    this.addRibbonIcon('sync', 'Sync with Notion', () => {
      this.showSyncModal();
    });

    // Add commands
    this.addCommand({
      id: 'sync-all-configs',
      name: 'Sync all configured folders/databases',
      callback: () => this.syncManager.syncAll()
    });

    this.addCommand({
      id: 'add-sync-config',
      name: 'Add new sync configuration',
      callback: () => this.showConfigModal()
    });

    this.addCommand({
      id: 'notion-to-obsidian',
      name: 'Sync from Notion to Obsidian',
      callback: () => this.syncManager.syncAll(SyncDirection.NOTION_TO_OBSIDIAN)
    });

    this.addCommand({
      id: 'obsidian-to-notion',
      name: 'Sync from Obsidian to Notion',
      callback: () => this.syncManager.syncAll(SyncDirection.OBSIDIAN_TO_NOTION)
    });

    // Add settings tab
    this.settingsTab = new NotionSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Setup auto-sync if enabled
    if (this.settings.autoSync) {
      this.setupAutoSync();
    }
  }

  onunload() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.notionApi.updateToken(this.settings.notionToken);
    this.syncManager.updateSettings(this.settings);
  }

  setupAutoSync() {
    if (this.syncInterval) {
      window.clearInterval(this.syncInterval);
    }
    
    this.syncInterval = window.setInterval(() => {
      this.syncManager.syncAll();
    }, this.settings.syncInterval * 60 * 1000);
  }

  async showSyncModal() {
    const { SyncModal } = await import('./src/modals');
    new SyncModal(this.app, this.syncManager, this.settings.syncConfigs).open();
  }

  async showConfigModal() {
    const { ConfigModal } = await import('./src/modals');
    new ConfigModal(this.app, this.notionApi, (config: SyncConfig) => {
      this.settings.syncConfigs.push(config);
      this.saveSettings();
      // Refresh the settings page if it's currently open
      if (this.settingsTab) {
        this.settingsTab.display();
      }
    }).open();
  }
}