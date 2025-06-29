// sync-manager.ts
import { App, TFile, TFolder, Notice } from 'obsidian';
import { NotionAPI } from './notion-api';
import { SyncConfig, SyncDirection, NotionPage, ObsidianNote, NotionSyncSettings } from './types';

export class SyncManager {
  constructor(
    private app: App,
    private notionApi: NotionAPI,
    private settings: NotionSyncSettings
  ) {}

  updateSettings(settings: NotionSyncSettings) {
    this.settings = settings;
  }

  async syncAll(direction?: SyncDirection): Promise<void> {
    new Notice('Starting sync...');
    console.log('Starting sync with configs:', this.settings.syncConfigs);
    
    let successCount = 0;
    let errorCount = 0;
    
    if (this.settings.syncConfigs.length === 0) {
      new Notice('No sync configurations found. Please add a configuration first.');
      return;
    }
    
    for (const config of this.settings.syncConfigs) {
      if (!config.enabled) {
        console.log(`Skipping disabled config: ${config.name}`);
        continue;
      }
      
      try {
        console.log(`Starting sync for config: ${config.name}`);
        await this.syncConfig(config, direction);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Sync failed for ${config.name}:`, error);
        new Notice(`❌ Sync failed for ${config.name}: ${error.message}`, 10000);
      }
    }
    
    new Notice(`Sync completed! ✅ ${successCount} successful, ❌ ${errorCount} failed.`);
  }

  async syncConfig(config: SyncConfig, overrideDirection?: SyncDirection): Promise<void> {
    const direction = overrideDirection || config.syncDirection;
    
    console.log(`Syncing config:`, {
      name: config.name,
      direction,
      notionDatabaseId: config.notionDatabaseId,
      obsidianFolder: config.obsidianFolder,
      fieldMappings: config.fieldMappings
    });
    
    new Notice(`Syncing ${config.name}...`);
    
    try {
      // Validate configuration
      if (!config.notionDatabaseId) {
        throw new Error('No Notion database ID specified');
      }
      
      if (!config.obsidianFolder) {
        throw new Error('No Obsidian folder specified');
      }
      
      // Warn about field mappings and adjust direction if needed
      let actualDirection = direction;
      if (config.fieldMappings.length === 0) {
        console.warn(`⚠️ No field mappings configured for "${config.name}". Auto-sync will work for Notion→Obsidian, but Obsidian→Notion requires field mappings.`);
        if (direction === SyncDirection.OBSIDIAN_TO_NOTION) {
          throw new Error('Cannot sync from Obsidian to Notion without field mappings. Please configure field mappings first.');
        } else if (direction === SyncDirection.BIDIRECTIONAL) {
          console.log('Forcing sync direction to Notion→Obsidian only due to missing field mappings');
          actualDirection = SyncDirection.NOTION_TO_OBSIDIAN;
        }
      }

      switch (actualDirection) {
        case SyncDirection.NOTION_TO_OBSIDIAN:
          await this.syncNotionToObsidian(config);
          break;
        case SyncDirection.OBSIDIAN_TO_NOTION:
          await this.syncObsidianToNotion(config);
          break;
        case SyncDirection.BIDIRECTIONAL:
          await this.syncBidirectional(config);
          break;
        default:
          throw new Error(`Unknown sync direction: ${direction}`);
      }

      config.lastSync = Date.now();
      
      // Save updated settings - try multiple methods to find the plugin
      try {
        const plugins = (this.app as any).plugins;
        let plugin = plugins.plugins['notion-obsidian-sync'];
        
        if (!plugin) {
          // Try alternative plugin names
          plugin = plugins.plugins['notion-sync'] || 
                   plugins.plugins['obsidian-notion-sync'];
        }
        
        if (plugin && plugin.saveSettings) {
          await plugin.saveSettings();
          console.log('Settings saved successfully');
        } else {
          console.warn('Could not find plugin instance to save settings');
        }
      } catch (saveError) {
        console.error('Failed to save settings:', saveError);
      }
      
      new Notice(`✅ ${config.name} synced successfully!`);
    } catch (error) {
      console.error(`Sync config failed:`, error);
      throw new Error(`Failed to sync ${config.name}: ${error.message}`);
    }
  }

  private async syncNotionToObsidian(config: SyncConfig): Promise<void> {
    console.log(`Starting Notion → Obsidian sync for database: ${config.notionDatabaseId}`);
    
    const notionPages = await this.notionApi.getDatabasePages(config.notionDatabaseId);
    console.log(`Found ${notionPages.length} pages in Notion database`);
    
    if (notionPages.length === 0) {
      new Notice(`No pages found in Notion database for ${config.name}`);
      return;
    }
    
    const folder = await this.ensureFolderExists(config.obsidianFolder);
    
    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const page of notionPages) {
      try {
        console.log(`Processing page:`, page.id);
        
        const fileName = this.getFileNameFromPage(page, config);
        const filePath = `${config.obsidianFolder}/${fileName}.md`;
        
        console.log(`Converting page to file: ${filePath}`);
        
        const frontmatter = await this.convertNotionPropertiesToFrontmatter(page.properties, config);
        frontmatter.notionId = page.id;
        frontmatter.lastNotionSync = new Date(page.lastModified).toISOString();
        
        const content = this.createMarkdownContent(frontmatter, page.content);
        
        const existingFile = this.app.vault.getAbstractFileByPath(filePath) as TFile;
        
        if (existingFile) {
          await this.app.vault.modify(existingFile, content);
          updatedCount++;
          console.log(`Updated file: ${filePath}`);
        } else {
          await this.app.vault.create(filePath, content);
          createdCount++;
          console.log(`Created file: ${filePath}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`Failed to sync page ${page.id}:`, error);
        new Notice(`Failed to sync page ${page.id}: ${error.message}`, 5000);
      }
    }

    const message = `Notion → Obsidian: ${createdCount} created, ${updatedCount} updated`;
    if (errorCount > 0) {
      console.log(`${message}, ${errorCount} errors`);
      new Notice(`${message}, ${errorCount} errors. Check console for details.`);
    } else {
      console.log(message);
      new Notice(message);
    }
  }

  private async syncObsidianToNotion(config: SyncConfig): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(config.obsidianFolder) as TFolder;
    if (!folder) {
      throw new Error(`Folder ${config.obsidianFolder} not found`);
    }

    const files = this.getAllMarkdownFiles(folder);
    
    let createdCount = 0;
    let updatedCount = 0;
    
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const note = this.parseMarkdownFile(file, content);
        
                  const notionProperties = this.convertFrontmatterToNotionProperties(note.frontmatter, config);
        
        if (note.notionId) {
          // Update existing page
          await this.notionApi.updatePage(note.notionId, notionProperties, note.content);
          updatedCount++;
        } else {
          // Create new page
          const pageId = await this.notionApi.createPage(config.notionDatabaseId, notionProperties, note.content);
          
          // Update the obsidian file with the notion ID
          const updatedFrontmatter = { 
            ...note.frontmatter, 
            notionId: pageId,
            lastObsidianSync: new Date().toISOString()
          };
          const updatedContent = this.createMarkdownContent(updatedFrontmatter, note.content);
          await this.app.vault.modify(file, updatedContent);
          createdCount++;
        }
      } catch (error) {
        console.error(`Failed to sync file ${file.path}:`, error);
      }
    }

    console.log(`Obsidian → Notion: ${createdCount} created, ${updatedCount} updated`);
  }

  private async syncBidirectional(config: SyncConfig): Promise<void> {
    // Get data from both sources
    const notionPages = await this.notionApi.getDatabasePages(config.notionDatabaseId);
    const folder = this.app.vault.getAbstractFileByPath(config.obsidianFolder) as TFolder;
    
    let obsidianNotes: ObsidianNote[] = [];
    if (folder) {
      const files = this.getAllMarkdownFiles(folder);
      obsidianNotes = await Promise.all(
        files.map(async file => {
          const content = await this.app.vault.read(file);
          return this.parseMarkdownFile(file, content);
        })
      );
    }

    // Create maps for easy lookup
    const notionMap = new Map(notionPages.map(page => [page.id, page]));
    const obsidianMap = new Map(
      obsidianNotes
        .filter(note => note.notionId)
        .map(note => [note.notionId!, note])
    );

    let conflicts = 0;
    let notionToObsidian = 0;
    let obsidianToNotion = 0;
    let created = 0;

    // Handle pages that exist in Notion
    for (const page of notionPages) {
      const correspondingNote = obsidianMap.get(page.id);
      
      if (!correspondingNote) {
        // New in Notion, create in Obsidian
        await this.createObsidianFromNotion(page, config);
        created++;
      } else {
        // Exists in both, check for conflicts
        const result = await this.resolveConflict(page, correspondingNote, config);
        if (result === 'conflict') conflicts++;
        else if (result === 'notion-wins') notionToObsidian++;
        else if (result === 'obsidian-wins') obsidianToNotion++;
      }
    }

    // Handle notes that exist only in Obsidian
    for (const note of obsidianNotes) {
      if (!note.notionId || !notionMap.has(note.notionId)) {
        // New in Obsidian, create in Notion
        await this.createNotionFromObsidian(note, config);
        created++;
      }
    }

    console.log(`Bidirectional sync: ${created} created, ${notionToObsidian} N→O, ${obsidianToNotion} O→N, ${conflicts} conflicts`);
    if (conflicts > 0) {
      new Notice(`${conflicts} conflicts detected. Check console for details.`);
    }
  }

  private async resolveConflict(
    notionPage: NotionPage, 
    obsidianNote: ObsidianNote, 
    config: SyncConfig
  ): Promise<string> {
    const notionModified = new Date(notionPage.lastModified).getTime();
    const obsidianModified = obsidianNote.lastModified;

    // Check if there are actual differences
    const notionFrontmatter = await this.convertNotionPropertiesToFrontmatter(notionPage.properties, config);
    const hasPropertyChanges = this.hasSignificantChanges(notionFrontmatter, obsidianNote.frontmatter, config);
    const hasContentChanges = this.normalizeContent(notionPage.content) !== this.normalizeContent(obsidianNote.content);

    if (!hasPropertyChanges && !hasContentChanges) {
      // No actual changes, just update sync timestamps
      return 'no-change';
    }

    switch (this.settings.conflictResolution) {
      case 'notion-wins':
        await this.updateObsidianFromNotion(notionPage, config);
        return 'notion-wins';
        
      case 'obsidian-wins':
        await this.updateNotionFromObsidian(obsidianNote, config);
        return 'obsidian-wins';
        
      case 'newer-wins':
        if (notionModified > obsidianModified) {
          await this.updateObsidianFromNotion(notionPage, config);
          return 'notion-wins';
        } else {
          await this.updateNotionFromObsidian(obsidianNote, config);
          return 'obsidian-wins';
        }
        
      case 'manual':
        new Notice(`Conflict detected: ${obsidianNote.path}. Manual resolution required.`);
        console.warn('Conflict details:', {
          file: obsidianNote.path,
          notionModified: new Date(notionModified),
          obsidianModified: new Date(obsidianModified),
          hasPropertyChanges,
          hasContentChanges
        });
        return 'conflict';
        
      default:
        return 'no-change';
    }
  }

  private hasSignificantChanges(notion: any, obsidian: any, config: SyncConfig): boolean {
    for (const mapping of config.fieldMappings) {
      const notionValue = notion[mapping.obsidianProperty];
      const obsidianValue = obsidian[mapping.obsidianProperty];
      
      if (this.normalizeValue(notionValue) !== this.normalizeValue(obsidianValue)) {
        return true;
      }
    }
    return false;
  }

  private normalizeValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.sort().join(',');
    return String(value).trim();
  }

  private normalizeContent(content: string): string {
    return content.replace(/\r\n/g, '\n').trim();
  }

  private async ensureFolderExists(folderPath: string): Promise<TFolder> {
    let folder = this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
      folder = this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
    }
    return folder;
  }

  private getFileNameFromPage(page: NotionPage, config: SyncConfig): string {
    // Try to get title from mapped fields first (look for text type mapping to title property)
    const titleMapping = config.fieldMappings.find(m => 
      m.notionProperty.toLowerCase().includes('title') || 
      m.notionProperty.toLowerCase() === 'name'
    );
    if (titleMapping && page.properties[titleMapping.notionProperty]) {
      const titleProp = page.properties[titleMapping.notionProperty];
      if (titleProp.type === 'title' && titleProp.title.length > 0) {
        const title = titleProp.title[0].plain_text;
        if (title.trim()) {
          return this.sanitizeFileName(title);
        }
      }
    }

    // Fallback: look for any title property (common case for auto-sync)
    for (const [key, prop] of Object.entries(page.properties)) {
      if ((prop as any).type === 'title' && (prop as any).title?.length > 0) {
        const title = (prop as any).title[0].plain_text;
        if (title.trim()) {
          console.log(`Using auto-detected title property "${key}": ${title}`);
          return this.sanitizeFileName(title);
        }
      }
    }

    // Try to find Name property (common in Notion databases)
    if (page.properties.Name && (page.properties.Name as any).title?.length > 0) {
      const title = (page.properties.Name as any).title[0].plain_text;
      if (title.trim()) {
        console.log(`Using Name property: ${title}`);
        return this.sanitizeFileName(title);
      }
    }

    // Final fallback - use page ID
    console.log(`No title found for page ${page.id}, using ID as filename`);
    return `Notion-Page-${page.id.substring(0, 8)}`;
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim()
      .substring(0, 100); // Limit length
  }

  private async convertNotionPropertiesToFrontmatter(properties: any, config: SyncConfig): Promise<any> {
    const frontmatter: any = {};
    
    // If no field mappings configured, auto-convert all properties
    if (config.fieldMappings.length === 0) {
      console.log('No field mappings configured, auto-converting all Notion properties');
      
      for (const [propName, notionProp] of Object.entries(properties)) {
        if (!notionProp || typeof notionProp !== 'object') continue;
        
        let value;
        try {
          switch ((notionProp as any).type) {
            case 'title':
              value = (notionProp as any).title?.map((t: any) => t.plain_text).join('') || '';
              break;
            case 'rich_text':
              value = (notionProp as any).rich_text?.map((t: any) => t.plain_text).join('') || '';
              break;
            case 'number':
              value = (notionProp as any).number;
              break;
            case 'date':
              value = (notionProp as any).date?.start;
              break;
            case 'select':
              value = (notionProp as any).select?.name;
              break;
            case 'multi_select':
              value = (notionProp as any).multi_select?.map((s: any) => s.name) || [];
              break;
            case 'checkbox':
              value = (notionProp as any).checkbox;
              break;
            case 'url':
              value = (notionProp as any).url;
              break;
            case 'email':
              value = (notionProp as any).email;
              break;
            case 'phone_number':
              value = (notionProp as any).phone_number;
              break;
            case 'status':
              value = (notionProp as any).status?.name || 'Not started';
              break;
            case 'relation':
              // Extract relation titles asynchronously
              const relations = (notionProp as any).relation || [];
              value = await this.getRelationDisplayText(relations);
              break;
            case 'created_time':
              value = (notionProp as any).created_time;
              break;
            case 'last_edited_time':
              value = (notionProp as any).last_edited_time;
              break;
            case 'created_by':
              value = (notionProp as any).created_by?.name || 'Unknown user';
              break;
            case 'last_edited_by':
              value = (notionProp as any).last_edited_by?.name || 'Unknown user';
              break;
            case 'formula':
              // Formula results can be different types
              const formulaResult = (notionProp as any).formula;
              if (formulaResult?.type === 'string') {
                value = formulaResult.string;
              } else if (formulaResult?.type === 'number') {
                value = formulaResult.number;
              } else if (formulaResult?.type === 'boolean') {
                value = formulaResult.boolean;
              } else if (formulaResult?.type === 'date') {
                value = formulaResult.date?.start;
              } else {
                value = 'Formula result';
              }
              break;
            case 'rollup':
              // Rollup can have different result types
              const rollupResult = (notionProp as any).rollup;
              if (rollupResult?.type === 'array') {
                value = `${rollupResult.array?.length || 0} items`;
              } else if (rollupResult?.type === 'number') {
                value = rollupResult.number;
              } else {
                value = 'Rollup result';
              }
              break;
            case 'people':
              const people = (notionProp as any).people || [];
              value = people.map((p: any) => p.name).join(', ') || 'No people';
              break;
            case 'files':
              const files = (notionProp as any).files || [];
              value = files.length > 0 ? `${files.length} files` : 'No files';
              break;
            default:
              console.warn(`Unsupported property type: ${(notionProp as any).type} for ${propName}`);
              // Still try to extract some basic info
              value = `[${(notionProp as any).type}]`;
          }

          // Convert property name to frontmatter-friendly format
          const frontmatterKey = propName.toLowerCase().replace(/\s+/g, '_');
          
          // Always include the property, even if empty, to show the structure
          if (value !== null && value !== undefined) {
            frontmatter[frontmatterKey] = value;
            console.log(`Auto-converted: ${propName} -> ${frontmatterKey} = ${value}`);
          } else {
            // For empty properties, still include them but mark as empty
            frontmatter[frontmatterKey] = '';
            console.log(`Auto-converted: ${propName} -> ${frontmatterKey} = [empty]`);
          }
        } catch (error) {
          console.error(`Error auto-converting property ${propName}:`, error);
          // Still add the property but mark as error
          const frontmatterKey = propName.toLowerCase().replace(/\s+/g, '_');
          frontmatter[frontmatterKey] = '[conversion error]';
        }
      }
      
      return frontmatter;
    }
    
    // Use configured field mappings
    for (const mapping of config.fieldMappings) {
      const notionProp = properties[mapping.notionProperty];
      if (!notionProp) continue;

      let value;
      try {
        switch (notionProp.type) {
          case 'title':
            value = notionProp.title?.map((t: any) => t.plain_text).join('') || '';
            break;
          case 'rich_text':
            value = notionProp.rich_text?.map((t: any) => t.plain_text).join('') || '';
            break;
          case 'number':
            value = notionProp.number;
            break;
          case 'date':
            value = notionProp.date?.start;
            break;
          case 'select':
            value = notionProp.select?.name;
            break;
          case 'multi_select':
            value = notionProp.multi_select?.map((s: any) => s.name) || [];
            break;
          case 'checkbox':
            value = notionProp.checkbox;
            break;
          case 'url':
            value = notionProp.url;
            break;
          case 'email':
            value = notionProp.email;
            break;
          case 'phone_number':
            value = notionProp.phone_number;
            break;
          case 'status':
            value = notionProp.status?.name || 'Not started';
            break;
          case 'relation':
            // Extract relation titles asynchronously
            const relations = notionProp.relation || [];
            value = await this.getRelationDisplayText(relations);
            break;
          case 'created_time':
            value = notionProp.created_time;
            break;
          case 'last_edited_time':
            value = notionProp.last_edited_time;
            break;
          case 'created_by':
            value = notionProp.created_by?.name || 'Unknown user';
            break;
          case 'last_edited_by':
            value = notionProp.last_edited_by?.name || 'Unknown user';
            break;
          case 'formula':
            // Formula results can be different types
            const formulaResult = notionProp.formula;
            if (formulaResult?.type === 'string') {
              value = formulaResult.string;
            } else if (formulaResult?.type === 'number') {
              value = formulaResult.number;
            } else if (formulaResult?.type === 'boolean') {
              value = formulaResult.boolean;
            } else if (formulaResult?.type === 'date') {
              value = formulaResult.date?.start;
            } else {
              value = 'Formula result';
            }
            break;
          case 'rollup':
            // Rollup can have different result types
            const rollupResult = notionProp.rollup;
            if (rollupResult?.type === 'array') {
              value = `${rollupResult.array?.length || 0} items`;
            } else if (rollupResult?.type === 'number') {
              value = rollupResult.number;
            } else {
              value = 'Rollup result';
            }
            break;
          case 'people':
            const people = notionProp.people || [];
            value = people.map((p: any) => p.name).join(', ') || 'No people';
            break;
          case 'files':
            const files = notionProp.files || [];
            value = files.length > 0 ? `${files.length} files` : 'No files';
            break;
          default:
            console.warn(`Unsupported property type: ${notionProp.type}`);
            continue;
        }

        if (value !== null && value !== undefined) {
          frontmatter[mapping.obsidianProperty] = value;
        }
      } catch (error) {
        console.error(`Error converting property ${mapping.notionProperty}:`, error);
      }
    }

    return frontmatter;
  }

  private convertFrontmatterToNotionProperties(frontmatter: any, config: SyncConfig): any {
    const properties: any = {};

    // If no field mappings, we can't safely convert back to Notion
    // This is expected for auto-created configs - they should be Notion->Obsidian only initially
    if (config.fieldMappings.length === 0) {
      console.log('No field mappings configured - skipping frontmatter to Notion conversion');
      console.log('Configure field mappings to enable Obsidian->Notion sync');
      return properties;
    }

    for (const mapping of config.fieldMappings) {
      const value = frontmatter[mapping.obsidianProperty];
      if (value === undefined || value === null) continue;

      try {
        // We'll need to determine the Notion property type from the database schema
        // For now, we'll use a simple approach based on the mapping type
        
        switch (mapping.type) {
          case 'text':
            // Default to rich_text for text mappings
            properties[mapping.notionProperty] = {
              rich_text: [{ type: 'text', text: { content: String(value) } }]
            };
            break;
          case 'list':
            // Convert list to multi_select format
            const values = Array.isArray(value) ? value : [value];
            properties[mapping.notionProperty] = {
              multi_select: values.map((v: any) => ({ name: String(v) }))
            };
            break;
          case 'number':
            const numValue = Number(value);
            if (!isNaN(numValue)) {
              properties[mapping.notionProperty] = { number: numValue };
            }
            break;
          case 'date':
          case 'date & time':
            properties[mapping.notionProperty] = { date: { start: String(value) } };
            break;
          case 'checkbox':
            properties[mapping.notionProperty] = { checkbox: Boolean(value) };
            break;
          default:
            console.warn(`Unsupported mapping type: ${mapping.type}`);
        }
      } catch (error) {
        console.error(`Error converting frontmatter ${mapping.obsidianProperty}:`, error);
      }
    }

    return properties;
  }

  private createMarkdownContent(frontmatter: any, content: string): string {
    let frontmatterYaml = '';
    
    if (Object.keys(frontmatter).length > 0) {
      frontmatterYaml = '---\n';
      for (const [key, value] of Object.entries(frontmatter)) {
        if (Array.isArray(value)) {
          frontmatterYaml += `${key}: [${value.map(v => `"${v}"`).join(', ')}]\n`;
        } else if (typeof value === 'string') {
          frontmatterYaml += `${key}: "${value}"\n`;
        } else {
          frontmatterYaml += `${key}: ${value}\n`;
        }
      }
      frontmatterYaml += '---\n\n';
    }
    
    return frontmatterYaml + content;
  }

  private parseMarkdownFile(file: TFile, content: string): ObsidianNote {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);
    
    let frontmatter: any = {};
    let noteContent = content;

    if (match) {
      try {
        // Simple YAML parsing (you might want to use a proper YAML parser)
        const yamlLines = match[1].split('\n');
        for (const line of yamlLines) {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            let value: any = line.substring(colonIndex + 1).trim();
            
            // Handle different value types
            if (value.startsWith('"') && value.endsWith('"')) {
              value = value.slice(1, -1); // Remove quotes
            } else if (value.startsWith('[') && value.endsWith(']')) {
              // Parse array
              value = value.slice(1, -1).split(',').map((v: string) => v.trim().replace(/^"(.*)"$/, '$1'));
            } else if (value === 'true') {
              value = true;
            } else if (value === 'false') {
              value = false;
            } else if (!isNaN(Number(value))) {
              value = Number(value);
            }
            
            frontmatter[key] = value;
          }
        }
        noteContent = content.substring(match[0].length);
      } catch (error) {
        console.error('Error parsing frontmatter:', error);
      }
    }

    return {
      path: file.path,
      frontmatter,
      content: noteContent,
      lastModified: file.stat.mtime,
      notionId: frontmatter.notionId
    };
  }

  private getAllMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    
    const addFiles = (currentFolder: TFolder) => {
      for (const child of currentFolder.children) {
        if (child instanceof TFile && child.extension === 'md') {
          files.push(child);
        } else if (child instanceof TFolder) {
          addFiles(child);
        }
      }
    };

    addFiles(folder);
    return files;
  }

  // Helper methods for bidirectional sync
  private async createObsidianFromNotion(page: NotionPage, config: SyncConfig): Promise<void> {
    const fileName = this.getFileNameFromPage(page, config);
    const filePath = `${config.obsidianFolder}/${fileName}.md`;
    
    const frontmatter = await this.convertNotionPropertiesToFrontmatter(page.properties, config);
    frontmatter.notionId = page.id;
    frontmatter.lastNotionSync = new Date(page.lastModified).toISOString();
    
    const content = this.createMarkdownContent(frontmatter, page.content);
    await this.app.vault.create(filePath, content);
  }

  private async createNotionFromObsidian(note: ObsidianNote, config: SyncConfig): Promise<void> {
    const properties = this.convertFrontmatterToNotionProperties(note.frontmatter, config);
    const pageId = await this.notionApi.createPage(config.notionDatabaseId, properties, note.content);
    
    // Update Obsidian file with Notion ID
    const updatedFrontmatter = { 
      ...note.frontmatter, 
      notionId: pageId,
      lastObsidianSync: new Date().toISOString()
    };
    const updatedContent = this.createMarkdownContent(updatedFrontmatter, note.content);
    const file = this.app.vault.getAbstractFileByPath(note.path) as TFile;
    if (file) {
      await this.app.vault.modify(file, updatedContent);
    }
  }

  private async updateObsidianFromNotion(page: NotionPage, config: SyncConfig): Promise<void> {
    const fileName = this.getFileNameFromPage(page, config);
    const filePath = `${config.obsidianFolder}/${fileName}.md`;
    
    const frontmatter = await this.convertNotionPropertiesToFrontmatter(page.properties, config);
    frontmatter.notionId = page.id;
    frontmatter.lastNotionSync = new Date(page.lastModified).toISOString();
    
    const content = this.createMarkdownContent(frontmatter, page.content);
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
    
    if (file) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  private async updateNotionFromObsidian(note: ObsidianNote, config: SyncConfig): Promise<void> {
    if (!note.notionId) return;
    
    const properties = this.convertFrontmatterToNotionProperties(note.frontmatter, config);
    await this.notionApi.updatePage(note.notionId, properties, note.content);
    
    // Update sync timestamp in Obsidian
    const updatedFrontmatter = {
      ...note.frontmatter,
      lastObsidianSync: new Date().toISOString()
    };
    const updatedContent = this.createMarkdownContent(updatedFrontmatter, note.content);
    const file = this.app.vault.getAbstractFileByPath(note.path) as TFile;
    if (file) {
      await this.app.vault.modify(file, updatedContent);
    }
  }

  private async getRelationDisplayText(relations: any[]): Promise<string> {
    if (!relations || relations.length === 0) {
      return '';
    }

    const relationTexts: string[] = [];
    
    for (const relation of relations) {
      try {
        // Get the actual page title from Notion
        if (relation.id) {
          const pageInfo = await this.notionApi.getPageInfo(relation.id);
          if (pageInfo && pageInfo.title) {
            relationTexts.push(pageInfo.title);
          } else {
            relationTexts.push('Untitled');
          }
        }
      } catch (error) {
        console.error(`Failed to get page title for relation ${relation.id}:`, error);
        relationTexts.push('Unknown');
      }
    }
    
    return relationTexts.join(', ');
  }
}