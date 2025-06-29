import { Notice, requestUrl } from 'obsidian';
import { NotionPage } from './types';

export class NotionAPI {
  private token: string;
  private baseUrl = 'https://api.notion.com/v1';

  constructor(token: string) {
    this.token = token;
  }

  updateToken(token: string) {
    this.token = token;
  }

  async validateToken(): Promise<{ valid: boolean; message: string; user?: any }> {
    if (!this.token) {
      return { valid: false, message: 'No token provided' };
    }

    // Basic token format validation - Notion tokens are typically long alphanumeric strings
    if (this.token.length < 10) {
      return { valid: false, message: 'Token appears to be too short' };
    }

    try {
      console.log('Validating token with Notion API...');
      
      // Use a simple search request to validate the token
      const response = await this.requestWithoutNotice('/search', {
        method: 'POST',
        body: JSON.stringify({
          query: '',
          page_size: 1
        })
      });
      
      console.log('Token validation successful:', response);
      
      // If we get here, the token is valid
      return { 
        valid: true, 
        message: `Token valid! Successfully connected to Notion API.`,
        user: response
      };
    } catch (error) {
      console.error('Token validation failed:', error);
      
      // Parse the actual error message
      let errorMessage = 'Unknown error';
      
      if (error.message.includes('Failed to fetch') || error.message.includes('fetch')) {
        errorMessage = 'Network error: Cannot connect to Notion API. Check your internet connection.';
      } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        errorMessage = 'Invalid token - check your API key';
      } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
        errorMessage = 'Token lacks required permissions';
      } else if (error.message.includes('404')) {
        errorMessage = 'API endpoint not found';
      } else if (error.message.includes('429')) {
        errorMessage = 'Rate limit exceeded - try again later';
      } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Network connection failed - check if you can access notion.com';
      } else {
        errorMessage = `Connection error: ${error.message}`;
      }
      
      return { 
        valid: false, 
        message: errorMessage
      };
    }
  }

  async validateDatabase(databaseId: string): Promise<{ valid: boolean; message: string; database?: any }> {
    try {
      console.log('Validating database connection...', databaseId);
      
      // Clean up database ID format
      const cleanId = databaseId.replace(/[-\s]/g, '');
      
      const response = await this.requestWithoutNotice(`/databases/${cleanId}`, {
        method: 'GET'
      });
      
      console.log('Database validation response:', response);
      
      if (response && response.id) {
        return {
          valid: true,
          message: `Database connection successful! Database name: ${response.title?.[0]?.plain_text || 'Unknown'}`,
          database: response
        };
      } else {
        return {
          valid: false,
          message: 'Unable to access database'
        };
      }
    } catch (error) {
      console.error('Database validation failed:', error);
      let message = `Database connection failed: ${error.message}`;
      
      if (error.message.includes('401')) {
        message = 'Database connection failed: No permission to access, please check if API Token is valid';
      } else if (error.message.includes('404')) {
        message = 'Database connection failed: Database does not exist, please check if the database ID is correct';
      } else if (error.message.includes('400')) {
        message = 'Database connection failed: Invalid database ID format';
      }
      
      return {
        valid: false,
        message
      };
    }
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers
    };

    console.log('Making request to:', url);

    try {
      // Use Obsidian's built-in requestUrl method
      const requestOptions: any = {
        url,
        method: options.method || 'GET',
        headers,
        throw: false // Don't throw on HTTP errors
      };
      
      // Only add body if it exists
      if (options.body) {
        requestOptions.body = options.body;
      }
      
      console.log('Using Obsidian requestUrl with options:', requestOptions);
      const response = await requestUrl(requestOptions);
      
      console.log('Obsidian response:', response);
      
      if (response.status >= 400) {
        let errorMessage = `HTTP ${response.status}: ${response.status === 401 ? 'Unauthorized' : 'Request failed'}`;
        
        try {
          if (response.json && typeof response.json === 'object') {
            if (response.json.message) {
              errorMessage = response.json.message;
            }
          } else if (response.text) {
            errorMessage = response.text;
          }
        } catch {
          // Use default error message
        }
        
        new Notice(`Notion API request failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }
      
      return response.json || JSON.parse(response.text || '{}');
    } catch (fetchError) {
      console.error('Request error:', fetchError);
      
      // More specific error handling
      let errorMessage = `Notion API request failed: ${fetchError.message}`;
      if (fetchError.message.includes('CORS')) {
        errorMessage = 'CORS error - API access blocked by browser';
      } else if (fetchError.message.includes('Network')) {
        errorMessage = 'Network error - check internet connection';
      } else if (fetchError.name === 'TypeError' && fetchError.message.includes('fetch')) {
        errorMessage = 'Failed to connect to Notion API - check network and firewall settings';
      }
      
      new Notice(errorMessage);
      throw new Error(errorMessage);
    }
  }

  // Request method without showing notices (for validation)
  private async requestWithoutNotice(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers
    };

    console.log('Making request to:', url);
    console.log('Headers:', { ...headers, 'Authorization': 'Bearer [HIDDEN]' });

    try {
      // Use Obsidian's built-in requestUrl method
      const requestOptions: any = {
        url,
        method: options.method || 'GET',
        headers,
        throw: false // Don't throw on HTTP errors
      };
      
      // Only add body if it exists
      if (options.body) {
        requestOptions.body = options.body;
      }
      
      console.log('Using Obsidian requestUrl with options:', requestOptions);
      const response = await requestUrl(requestOptions);
      
      console.log('Obsidian response:', response);
      
      if (response.status >= 400) {
        let errorMessage = `HTTP ${response.status}: ${response.status === 401 ? 'Unauthorized' : 'Request failed'}`;
        
        try {
          if (response.json && typeof response.json === 'object') {
            if (response.json.message) {
              errorMessage = response.json.message;
            }
          } else if (response.text) {
            errorMessage = response.text;
          }
        } catch {
          // Use default error message
        }
        
        throw new Error(errorMessage);
      }
      
      return response.json || JSON.parse(response.text || '{}');
    } catch (fetchError) {
      console.error('Request error:', fetchError);
      
      // More specific error handling
      if (fetchError.message.includes('CORS')) {
        throw new Error('CORS error - API access blocked by browser');
      } else if (fetchError.message.includes('Network')) {
        throw new Error('Network error - check internet connection');
      } else if (fetchError.name === 'TypeError' && fetchError.message.includes('fetch')) {
        throw new Error('Failed to connect to Notion API - check network and firewall settings');
      }
      
      throw fetchError;
    }
  }

  async getDatabases(): Promise<any[]> {
    const response = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          value: 'database',
          property: 'object'
        }
      })
    });

    return response.results || [];
  }

  async getDatabaseProperties(databaseId: string): Promise<any> {
    const response = await this.request(`/databases/${databaseId}`);
    console.log('Full database response:', response);
    console.log('Database properties from API:', response.properties);
    return response.properties || {};
  }

  async getDatabasePages(databaseId: string): Promise<NotionPage[]> {
    console.log(`Getting all pages from database: ${databaseId}`);
    const allPages: NotionPage[] = [];
    let startCursor: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore) {
      const requestBody: any = {
        page_size: 100 // Maximum allowed by Notion API
      };
      
      if (startCursor) {
        requestBody.start_cursor = startCursor;
      }

      console.log(`Fetching page ${pageCount + 1} of results...`);
      const response = await this.request(`/databases/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      console.log(`Retrieved ${response.results?.length || 0} pages in this batch`);

      // Process pages in this batch
      for (const page of response.results || []) {
        try {
          const content = await this.getPageContent(page.id);
          allPages.push({
            id: page.id,
            properties: page.properties,
            content: content,
            lastModified: page.last_edited_time
          });
        } catch (error) {
          console.error(`Failed to get content for page ${page.id}:`, error);
          // Still add the page without content rather than failing completely
          allPages.push({
            id: page.id,
            properties: page.properties,
            content: '',
            lastModified: page.last_edited_time
          });
        }
      }

      // Check if there are more pages
      hasMore = response.has_more || false;
      startCursor = response.next_cursor;
      pageCount++;

      console.log(`Total pages collected so far: ${allPages.length}`);
      
      if (hasMore && startCursor) {
        console.log(`Has more pages, continuing with cursor: ${startCursor.substring(0, 20)}...`);
      } else {
        console.log(`Finished collecting all pages. Total: ${allPages.length}`);
      }
    }

    console.log(`Successfully retrieved ${allPages.length} pages from database`);
    return allPages;
  }

  async getPageContent(pageId: string): Promise<string> {
    const response = await this.request(`/blocks/${pageId}/children`);
    return this.blocksToMarkdown(response.results || []);
  }

  async getPageInfo(pageId: string): Promise<{ title: string; id: string } | null> {
    try {
      const response = await this.request(`/pages/${pageId}`);
      
      // Extract title from page properties
      let title = 'Untitled';
      if (response.properties) {
        // Look for title property
        for (const [propName, propValue] of Object.entries(response.properties)) {
          if ((propValue as any).type === 'title') {
            const titleArray = (propValue as any).title || [];
            if (titleArray.length > 0) {
              title = titleArray.map((t: any) => t.plain_text).join('');
              break;
            }
          }
        }
      }
      
      return {
        id: pageId,
        title: title
      };
    } catch (error) {
      console.error(`Failed to get page info for ${pageId}:`, error);
      return null;
    }
  }

  async createPage(databaseId: string, properties: any, content: string): Promise<string> {
    const response = await this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: properties,
        children: this.markdownToBlocks(content)
      })
    });

    return response.id;
  }

  async updatePage(pageId: string, properties: any, content?: string): Promise<void> {
    // Update properties
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: properties
      })
    });

    // Update content if provided
    if (content) {
      // First, get existing blocks
      const existingBlocks = await this.request(`/blocks/${pageId}/children`);
      
      // Delete existing blocks
      for (const block of existingBlocks.results || []) {
        await this.request(`/blocks/${block.id}`, {
          method: 'DELETE'
        });
      }

      // Add new blocks
      const newBlocks = this.markdownToBlocks(content);
      if (newBlocks.length > 0) {
        await this.request(`/blocks/${pageId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({
            children: newBlocks
          })
        });
      }
    }
  }

  private blocksToMarkdown(blocks: any[]): string {
    let markdown = '';
    
    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph':
          markdown += block.paragraph.rich_text.map((t: any) => t.plain_text).join('') + '\n\n';
          break;
        case 'heading_1':
          markdown += '# ' + block.heading_1.rich_text.map((t: any) => t.plain_text).join('') + '\n\n';
          break;
        case 'heading_2':
          markdown += '## ' + block.heading_2.rich_text.map((t: any) => t.plain_text).join('') + '\n\n';
          break;
        case 'heading_3':
          markdown += '### ' + block.heading_3.rich_text.map((t: any) => t.plain_text).join('') + '\n\n';
          break;
        case 'bulleted_list_item':
          markdown += '- ' + block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join('') + '\n';
          break;
        case 'numbered_list_item':
          markdown += '1. ' + block.numbered_list_item.rich_text.map((t: any) => t.plain_text).join('') + '\n';
          break;
        default:
          // Handle other block types as plain text
          const textContent = block[block.type]?.rich_text?.map((t: any) => t.plain_text).join('') || '';
          if (textContent) {
            markdown += textContent + '\n\n';
          }
      }
    }

    return markdown.trim();
  }

  private markdownToBlocks(markdown: string): any[] {
    const blocks: any[] = [];
    const lines = markdown.split('\n');
    
    let currentParagraph = '';
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine === '') {
        if (currentParagraph) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: currentParagraph } }]
            }
          });
          currentParagraph = '';
        }
        continue;
      }
      
      if (trimmedLine.startsWith('# ')) {
        if (currentParagraph) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: currentParagraph } }]
            }
          });
          currentParagraph = '';
        }
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: trimmedLine.substring(2) } }]
          }
        });
      } else if (trimmedLine.startsWith('## ')) {
        if (currentParagraph) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: currentParagraph } }]
            }
          });
          currentParagraph = '';
        }
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: trimmedLine.substring(3) } }]
          }
        });
      } else if (trimmedLine.startsWith('### ')) {
        if (currentParagraph) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: currentParagraph } }]
            }
          });
          currentParagraph = '';
        }
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: trimmedLine.substring(4) } }]
          }
        });
      } else if (trimmedLine.startsWith('- ')) {
        if (currentParagraph) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: currentParagraph } }]
            }
          });
          currentParagraph = '';
        }
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: trimmedLine.substring(2) } }]
          }
        });
      } else if (/^\d+\. /.test(trimmedLine)) {
        if (currentParagraph) {
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: currentParagraph } }]
            }
          });
          currentParagraph = '';
        }
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: trimmedLine.replace(/^\d+\. /, '') } }]
          }
        });
      } else {
        currentParagraph += (currentParagraph ? ' ' : '') + trimmedLine;
      }
    }
    
    // Add any remaining paragraph
    if (currentParagraph) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: currentParagraph } }]
        }
      });
    }
    
    return blocks;
  }
}