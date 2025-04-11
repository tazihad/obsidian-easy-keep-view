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
    themeMode: "system" | "light" | "dark";
    openAsHomepage: boolean;
}

export const DEFAULT_SETTINGS: EasyKeepViewPluginSettings = {
    mySetting: "default",
    notesDB: [],
    themeMode: "system",
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

        containerEl.createEl("h2", { text: "Easy Keep View Plugin Settings" });

        // Theme mode selector
        new Setting(containerEl)
            .setName("Theme Mode")
            .setDesc("Select a theme mode for the Easy Keep View")
            .addDropdown(dropdown => {
                dropdown.addOption("system", "System (adapt)");
                dropdown.addOption("light", "Light");
                dropdown.addOption("dark", "Dark");
                dropdown.setValue(this.plugin.settings.themeMode);
                dropdown.onChange(async (value: "system" | "light" | "dark") => {
                    this.plugin.settings.themeMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.applyTheme();
                    this.plugin.refreshEasyKeepViewIfOpen();
                });
            });

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
