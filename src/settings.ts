// src/settings.ts

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import EasyKeepViewPlugin from "./main";  // Import your main plugin to access settings

export interface NoteEntry {
    path: string;
    title: string;
    excerpt: string;
    time: number;
    imageLink?: string;
}

export interface EasyKeepViewPluginSettings {
    mySetting: string;
    notesDB: NoteEntry[];
    openAsHomepage: boolean;
}

export const DEFAULT_SETTINGS: EasyKeepViewPluginSettings = {
    mySetting: "default",
    notesDB: [],
    openAsHomepage: false,
};


export class EasySettingTab extends PluginSettingTab {
    plugin: EasyKeepViewPlugin;

    constructor(app: App, plugin: EasyKeepViewPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Homepage toggle
        new Setting(containerEl)
            .setName("Use Easy Keep View as Home Page")
            .setDesc("Automatically open Easy Keep View when Obsidian starts")
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.openAsHomepage);
                toggle.onChange(async (value) => {
                    this.plugin.settings.openAsHomepage = value;
                    await this.plugin.saveSettings();
                    new Notice("Restart Obsidian to apply the homepage setting.");
                });
            });
    }
}
