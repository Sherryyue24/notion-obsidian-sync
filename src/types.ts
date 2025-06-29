export enum SyncMode {
    MANUAL = 'manual',
    AUTO = 'auto',
    SCHEDULED = 'scheduled'
  }
  
  export enum SyncDirection {
    BIDIRECTIONAL = 'bidirectional',
    NOTION_TO_OBSIDIAN = 'notion-to-obsidian',
    OBSIDIAN_TO_NOTION = 'obsidian-to-notion'
  }
  
  export interface SyncConfig {
    id: string;
    name: string;
    obsidianFolder: string;
    notionDatabaseId: string;
    syncDirection: SyncDirection;
    syncMode: SyncMode;
    fieldMappings: FieldMapping[];
    lastSync: number;
    enabled: boolean;
  }
  
  export interface NotionSyncSettings {
    notionToken: string;
    syncConfigs: SyncConfig[];
    defaultSyncMode: SyncMode;
    syncInterval: number; // minutes
    autoSync: boolean;
    conflictResolution: 'notion-wins' | 'obsidian-wins' | 'newer-wins' | 'manual';
  }
  
  export interface FieldMapping {
    notionProperty: string;
    obsidianProperty: string;
    type: 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'date & time';
  }
  
  export interface NotionPage {
    id: string;
    properties: Record<string, any>;
    content: string;
    lastModified: string;
  }
  
  export interface ObsidianNote {
    path: string;
    frontmatter: Record<string, any>;
    content: string;
    lastModified: number;
    notionId?: string;
  }