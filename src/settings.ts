// src/settings.ts

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import EasyKeepViewPlugin from "./main";

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

        new Setting(containerEl)
            .setName("Use easy keep view as home page")
            .setDesc("Automatically open easy keep view when obsidian starts")
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.openAsHomepage);
                toggle.onChange(async (value) => {
                    this.plugin.settings.openAsHomepage = value;
                    await this.plugin.saveSettings();
                    new Notice("Restart obsidian to apply the homepage setting.");
                });
            });
    }
}
