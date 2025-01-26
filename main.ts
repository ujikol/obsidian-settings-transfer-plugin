import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, PluginManifest } from 'obsidian';

interface SettingsMigratorSettings {
    lastExportedPaths: {[pluginId: string]: string[]};
}

const DEFAULT_SETTINGS: SettingsMigratorSettings = {
    lastExportedPaths: {}
}

export default class SettingsMigratorPlugin extends Plugin {
    settings: SettingsMigratorSettings;

    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
    }

    async onload() {
        await this.loadSettings();

        // Add export settings command
        this.addCommand({
            id: 'export-settings',
            name: 'Export plugin settings',
            callback: () => {
                new ExportSettingsModal(this.app, this).open();
            }
        });

        // Add import settings command
        this.addCommand({
            id: 'import-settings',
            name: 'Import plugin settings',
            callback: async () => {
                try {
                    const fileHandle = await window.showOpenFilePicker({
                        types: [{
                            description: 'JSON Files',
                            accept: {'application/json': ['.json']}
                        }]
                    });
                    
                    const file = await fileHandle[0].getFile();
                    const content = await file.text();
                    
                    const settings = JSON.parse(content);
                    
                    for (const pluginId in settings) {
                        try {
                            // Try community plugin first
                            const communityPlugin = this.app.plugins.plugins[pluginId];
                            
                            if (communityPlugin) {
                                // Handle community plugin
                                console.log(`Processing community plugin: ${pluginId}`);
                                let currentSettings = await communityPlugin.loadData() || {};
                                const newSettings = this.mergeSettings(currentSettings, settings[pluginId]);
                                await communityPlugin.saveData(newSettings);
                            } else if (await this.hasCoreSettings(pluginId)) {
                                // Handle core settings
                                console.log(`Processing core settings: ${pluginId}`);
                                await this.importCoreSettings(pluginId, settings[pluginId]);
                            } else {
                                // Neither plugin nor core settings found
                                const message = `Plugin not installed or invalid settings section: ${pluginId}`;
                                console.warn(message);
                                new Notice(message);
                                continue;
                            }
                        } catch (pluginError) {
                            console.error(`Error processing ${pluginId}:`, pluginError);
                        }
                    }
                    
                    new Notice('Settings imported successfully');
                } catch (error) {
                    console.error('Settings import error:', error);
                    new Notice('Error importing settings: ' + error.message);
                }
            }
        });

        this.addSettingTab(new SettingsMigratorSettingTab(this.app, this));
    }

    private mergeSettings(target: any, source: any): any {
        const output = {...target};
        
        for (const key in source) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                output[key] = this.mergeSettings(target[key] || {}, source[key]);
            } else {
                output[key] = source[key];
            }
        }
        
        return output;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async importCoreSettings(pluginId: string, settings: any) {
        try {
            // Core settings are stored in .obsidian/[pluginId].json
            const configDir = this.app.vault.configDir;
            const settingsPath = `${configDir}/${pluginId}.json`;
            
            // Read current settings
            let currentSettings = {};
            try {
                const currentContent = await this.app.vault.adapter.read(settingsPath);
                currentSettings = JSON.parse(currentContent);
            } catch (e) {
                // File might not exist yet, that's ok
                console.log(`No existing settings file for ${pluginId}`);
            }
            
            // Merge settings
            const newSettings = this.mergeSettings(currentSettings, settings);
            
            // Write back to file
            await this.app.vault.adapter.write(settingsPath, JSON.stringify(newSettings, null, 2));
            console.log(`Saved core settings for ${pluginId}`);
            
            return true;
        } catch (error) {
            console.error(`Error saving core settings for ${pluginId}:`, error);
            return false;
        }
    }

    async hasCoreSettings(pluginId: string): Promise<boolean> {
        const configDir = this.app.vault.configDir;
        const settingsPath = `${configDir}/${pluginId}.json`;
        try {
            await this.app.vault.adapter.read(settingsPath);
            return true;
        } catch (e) {
            return false;
        }
    }
}

class ExportSettingsModal extends Modal {
    plugin: SettingsMigratorPlugin;
    selectedPaths: {[pluginId: string]: string[]};
    
    constructor(app: App, plugin: SettingsMigratorPlugin) {
        super(app);
        this.plugin = plugin;
        this.selectedPaths = {...plugin.settings.lastExportedPaths};
    }

    async onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        
        // Add styles
        contentEl.createEl('style', {
            text: `
                .setting-group {
                    margin-left: 20px;
                }
                .setting-group-header {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    margin: 5px 0;
                }
                .setting-group-toggle {
                    cursor: pointer;
                    user-select: none;
                    width: 20px;
                }
                .setting-group-label {
                    font-weight: bold;
                }
                .setting-item {
                    margin-left: 45px;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .setting-item-label {
                    font-family: monospace;
                }
                .button-container {
                    margin-top: 20px;
                    text-align: right;
                }
            `
        });
        
        contentEl.createEl('h2', {text: 'Export Plugin Settings'});
        
        const pluginsDiv = contentEl.createDiv();
        
        // Add type definition for allPlugins
        const allPlugins: Record<string, { type: 'community' | 'core', plugin: any }> = {};
        
        // Add community plugins
        Object.entries(this.app.plugins.plugins).forEach(([id, plugin]) => {
            allPlugins[id] = { type: 'community', plugin };
        });
        
        // Add core plugins and settings
        const configDir = this.app.vault.configDir;
        try {
            const files = await this.app.vault.adapter.list(configDir);
            for (const file of files.files) {
                if (file.endsWith('.json')) {
                    const basename = file.split('/').pop()?.replace('.json', '');
                    if (basename && !allPlugins[basename]) {
                        // Check if it's a core plugin or core settings
                        const content = await this.app.vault.adapter.read(`${configDir}/${basename}.json`);
                        try {
                            const settings = JSON.parse(content);
                            if (Object.keys(settings).length > 0) {
                                allPlugins[basename] = { 
                                    type: 'core', 
                                    plugin: { data: settings }
                                };
                            }
                        } catch (e) {
                            console.warn(`Could not parse settings file: ${basename}.json`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error reading config directory:', error);
        }
        
        // Get and sort plugin IDs
        const pluginIds = Object.keys(allPlugins).sort();
        
        // Process each plugin
        for (const pluginId of pluginIds) {
            const { type, plugin } = allPlugins[pluginId];
            let settings;
            
            try {
                if (type === 'core') {
                    settings = plugin.data;
                } else {
                    // Community plugins
                    if (plugin.data) {
                        settings = plugin.data;
                    } else if (typeof plugin.loadData === 'function') {
                        settings = await plugin.loadData();
                    } else if (plugin.settings) {
                        settings = plugin.settings;
                    }
                }
                
                // Debug logging
                console.log(`Loaded settings for ${type} plugin ${pluginId}:`, settings);
                
                // Create UI elements if we have settings
                if (settings && Object.keys(settings).length > 0) {
                    const pluginContainer = pluginsDiv.createDiv({cls: 'plugin-settings-container'});
                    const headerDiv = pluginContainer.createDiv({cls: 'setting-group-header'});
                    const contentDiv = pluginContainer.createDiv({cls: 'setting-group-content'});
                    
                    const toggleButton = headerDiv.createSpan({cls: 'setting-group-toggle', text: '►'});
                    headerDiv.createEl('h3', {text: `${pluginId} (${type})`, cls: 'setting-group-label'});
                    
                    // Initially collapsed
                    contentDiv.style.display = 'none';
                    
                    toggleButton.addEventListener('click', () => {
                        const isCollapsed = contentDiv.style.display === 'none';
                        toggleButton.textContent = isCollapsed ? '▼' : '►';
                        contentDiv.style.display = isCollapsed ? 'block' : 'none';
                    });
                    
                    this.createSettingsTree(contentDiv, settings, pluginId);
                } else {
                    console.log(`No settings found for ${type} plugin: ${pluginId}`);
                }
            } catch (error) {
                console.error(`Error accessing settings for ${type} plugin ${pluginId}:`, error);
            }
        }
        
        // Add export button
        const buttonContainer = contentEl.createDiv({cls: 'button-container'});
        const exportButton = buttonContainer.createEl('button', {text: 'Export Selected'});
        
        exportButton.onclick = async () => {
            const exportData: {[pluginId: string]: any} = {};
            
            for (const pluginId in this.selectedPaths) {
                if (this.selectedPaths[pluginId].length > 0) {
                    let settings;
                    // Try to get plugin from both community and core plugins
                    const communityPlugin = this.app.plugins.plugins[pluginId];
                    const corePlugin = this.app.internalPlugins.plugins[pluginId]?.instance;
                    
                    if (communityPlugin) {
                        settings = await communityPlugin.loadData();
                    } else if (corePlugin) {
                        if (corePlugin.options) {
                            settings = corePlugin.options;
                        } else if (corePlugin.data) {
                            settings = corePlugin.data;
                        } else if (typeof corePlugin.loadData === 'function') {
                            settings = await corePlugin.loadData();
                        } else if (corePlugin.settings) {
                            settings = corePlugin.settings;
                        }
                    }
                    
                    if (settings) {
                        exportData[pluginId] = this.extractSelectedPaths(settings, this.selectedPaths[pluginId]);
                    }
                }
            }
            
            // Save selected paths
            this.plugin.settings.lastExportedPaths = this.selectedPaths;
            await this.plugin.saveSettings();
            
            // Export to file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'obsidian-settings-export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.close();
        };
    }

    private createSettingsTree(container: HTMLElement, settings: any, pluginId: string, path: string = '') {
        for (const key in settings) {
            const fullPath = path ? `${path}.${key}` : key;
            
            if (typeof settings[key] === 'object' && !Array.isArray(settings[key])) {
                const subContainer = container.createDiv({cls: 'setting-group'});
                const headerDiv = subContainer.createDiv({cls: 'setting-group-header'});
                const contentDiv = subContainer.createDiv({cls: 'setting-group-content'});
                
                // Add collapse/expand control
                const toggleButton = headerDiv.createSpan({cls: 'setting-group-toggle', text: '►'});
                
                const checkbox = headerDiv.createEl('input', {
                    type: 'checkbox',
                    attr: {
                        'data-path': fullPath,
                        'data-plugin': pluginId
                    }
                });
                
                headerDiv.createSpan({text: key, cls: 'setting-group-label'});
                
                // Set initial state from saved settings
                if (this.selectedPaths[pluginId]?.includes(fullPath)) {
                    checkbox.checked = true;
                }
                
                // Initially collapsed
                contentDiv.style.display = 'none';
                
                // Toggle functionality
                toggleButton.addEventListener('click', () => {
                    const isCollapsed = contentDiv.style.display === 'none';
                    toggleButton.textContent = isCollapsed ? '▼' : '►';
                    contentDiv.style.display = isCollapsed ? 'block' : 'none';
                });
                
                checkbox.addEventListener('change', () => {
                    if (!this.selectedPaths[pluginId]) {
                        this.selectedPaths[pluginId] = [];
                    }
                    
                    if (checkbox.checked) {
                        this.selectedPaths[pluginId].push(fullPath);
                    } else {
                        this.selectedPaths[pluginId] = this.selectedPaths[pluginId].filter(p => p !== fullPath);
                    }
                });
                
                this.createSettingsTree(contentDiv, settings[key], pluginId, fullPath);
            } else {
                const settingContainer = container.createDiv({cls: 'setting-item'});
                
                const checkbox = settingContainer.createEl('input', {
                    type: 'checkbox',
                    attr: {
                        'data-path': fullPath,
                        'data-plugin': pluginId
                    }
                });
                
                // Set initial state from saved settings
                if (this.selectedPaths[pluginId]?.includes(fullPath)) {
                    checkbox.checked = true;
                }
                
                settingContainer.createSpan({
                    text: `${key}: ${JSON.stringify(settings[key])}`,
                    cls: 'setting-item-label'
                });
                
                checkbox.addEventListener('change', () => {
                    if (!this.selectedPaths[pluginId]) {
                        this.selectedPaths[pluginId] = [];
                    }
                    
                    if (checkbox.checked) {
                        this.selectedPaths[pluginId].push(fullPath);
                    } else {
                        this.selectedPaths[pluginId] = this.selectedPaths[pluginId].filter(p => p !== fullPath);
                    }
                });
            }
        }
    }

    private extractSelectedPaths(settings: any, paths: string[]): any {
        const result: any = {};
        
        for (const path of paths) {
            const parts = path.split('.');
            let current = settings;
            let currentResult = result;
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                
                if (i === parts.length - 1) {
                    currentResult[part] = current[part];
                } else {
                    current = current[part];
                    currentResult[part] = currentResult[part] || {};
                    currentResult = currentResult[part];
                }
            }
        }
        
        return result;
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

class SettingsMigratorSettingTab extends PluginSettingTab {
    plugin: SettingsMigratorPlugin;

    constructor(app: App, plugin: SettingsMigratorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        containerEl.createEl('h2', {text: 'Settings Migrator Settings'});
        containerEl.createEl('p', {text: 'There are no settings to configure at this time.'});
    }
}
