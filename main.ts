import {
	App,
	Plugin,
	WorkspaceLeaf,
	ItemView,
	TFile,
	PluginSettingTab,
	Setting,
} from "obsidian";

import "./styles.css";

const VIEW_TYPE_EASY_KEEP = "easy-keep-view";

interface NoteEntry {
	path: string;
	title: string;
	excerpt: string;
	time: number;
	imageLink?: string;
}

interface MyPluginSettings {
	mySetting: string;
	notesDB: NoteEntry[];
	themeMode: "system" | "light" | "dark";
	openAsHomepage: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: "default",
	notesDB: [],
	themeMode: "system",
	openAsHomepage: false,
};



// Helper function to resolve image by name
function resolveImageByName(app: App, imageName: string): TFile | null {
	const target = imageName.replace(/\.(jpg|jpeg|png|webp)$/i, "").toLowerCase();
	const candidates = app.vault.getFiles().filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.name));
	for (const file of candidates) {
		if (file.basename.toLowerCase() === target) {
			return file;
		}
	}
	return null;
}

// Debounce function for throttling updates
function debounce(fn: (...args: any[]) => void, delay = 300): (...args: any[]) => void {
	let timer: NodeJS.Timeout;
	return (...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

class EasyKeepView extends ItemView {
	plugin: MyPlugin;
	private mainContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_EASY_KEEP;
	}

	getDisplayText(): string {
		return "Easy Keep View";
	}

	// Build the content of the view
	async buildContent() {
		this.mainContainer.empty();
		this.mainContainer.style.overflowY = "auto";
		this.mainContainer.style.height = "100%";

		const cardContainer = this.mainContainer.createDiv("easy-keep-cards-container");

		// New Note Card
		const newNoteCard = cardContainer.createDiv("easy-keep-card new-note-card");
		newNoteCard.createEl("h3", { text: "+" });
		newNoteCard.createEl("p", { text: "Add New Note" });
		newNoteCard.onclick = () => this.plugin.createNewNote();

		// Before building cards, refresh thumbnails from note content.
		await this.plugin.refreshThumbnails();

		let notes = this.plugin.settings.notesDB.slice()
		.sort((a, b) => b.time - a.time)
		.slice(0, 100);

		if (notes.length) {
			notes.forEach(note => {
				const card = cardContainer.createDiv("easy-keep-card");
				card.createEl("h3", { text: note.title });

				// Show thumbnail if imageLink is available, otherwise show excerpt
				if (note.imageLink) {
					let file = this.app.metadataCache.getFirstLinkpathDest(note.imageLink, note.path);
					if (!(file instanceof TFile)) {
						file = resolveImageByName(this.app, note.imageLink);
					}
					if (file instanceof TFile) {
						const resourcePath = this.app.vault.getResourcePath(file);
						const img = card.createEl("img", { cls: "easy-keep-thumbnail" });
						img.src = resourcePath;
						img.onerror = () => {
							console.warn("[Easy Keep View] Failed to load thumbnail:", resourcePath);
							img.remove();
							if (note.excerpt) card.createEl("p", { text: note.excerpt });
						};
						img.onload = () => {
							console.log("[Easy Keep View] Thumbnail loaded:", resourcePath);
						};
					} else if (note.excerpt) {
						card.createEl("p", { text: note.excerpt });
					}
				} else {
					// If no image link, show the excerpt instead
					if (note.excerpt) {
						card.createEl("p", { text: note.excerpt });
					}
				}

				card.onclick = () => this.plugin.openNoteInNewTab(note.path);
			});
		} else {
			const noHistory = cardContainer.createDiv("no-history-message");
			noHistory.setText("No notes, create a new one!");
		}
	}



	async refreshContent() {
		await this.buildContent();
	}

	// Initialize view on open
	async onOpen() {
		this.mainContainer = this.containerEl;

		// Wait until plugin settings are loaded
		await this.plugin.loadSettings();

		// Build content after settings are ready
		await this.buildContent();

		this.loadCSS();
	}

	// Load custom CSS
	loadCSS() {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = `${this.plugin.manifest.dir}/assets/styles.css`;
		document.head.appendChild(link);
	}

	async onClose() {}
}

// Plugin settings tab
class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	constructor(app: App, plugin: MyPlugin) {
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


export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private refreshDebounced: () => void;

	async onload() {
		await this.loadSettings();
		// Defer cleanDatabase until vault is ready
		this.app.workspace.onLayoutReady(async () => {
			await this.cleanDatabase();
			this.refreshEasyKeepViewIfOpen();

			if (this.settings.openAsHomepage) {
				await this.activateEasyKeepView();
			}
		});


		this.registerView(VIEW_TYPE_EASY_KEEP, (leaf) => new EasyKeepView(leaf, this));

		const ribbonIconEl = this.addRibbonIcon("dice", "Easy Keep View", () => {
			this.activateEasyKeepView();
		});
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// Refresh on file-open events.
		this.registerEvent(this.app.workspace.on("file-open", async (file) => {
			if (file) {
				await this.addToDatabase(file);
				this.refreshDebounced();
			}
		}));

		// Refresh on file deletion.
		this.registerEvent(this.app.vault.on("delete", async (file) => {
			if (file instanceof TFile) {
				await this.removeFromDatabase(file.path);
				this.refreshDebounced();
			}
		}));

		// Refresh on file rename for notes.
		this.registerEvent(this.app.vault.on("rename", async (file, oldPath) => {
			if (file instanceof TFile) {
				const entryIndex = this.settings.notesDB.findIndex(e => e.path === oldPath);
				if (entryIndex !== -1) {
					this.settings.notesDB[entryIndex].path = file.path;
					this.settings.notesDB[entryIndex].title = file.basename;
					await this.saveSettings();
					this.refreshDebounced();
				}
			}
		}));

		// Refresh on file rename for image files.
		this.registerEvent(this.app.vault.on("rename", async (file, oldPath) => {
			if (file instanceof TFile && /\.(jpg|jpeg|png|webp)$/i.test(file.path)) {
				let updated = false;
				this.settings.notesDB.forEach(entry => {
					if (entry.imageLink === oldPath) {
						entry.imageLink = file.path;
						updated = true;
					}
				});
				if (updated) {
					await this.saveSettings();
					this.refreshDebounced();
				}
			}
		}));

		// New: Listen for modify events to update thumbnail info when note content changes.
		this.registerEvent(this.app.vault.on("modify", async (file) => {
			if (file instanceof TFile) {
				await this.addToDatabase(file);
				this.refreshDebounced();
			}
		}));

		// Initialize debounce for refresh calls.
		this.refreshDebounced = debounce(() => this.refreshEasyKeepViewIfOpen(), 300);

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_EASY_KEEP);
	}

	// Activate the view
	async activateEasyKeepView() {
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
		if (existingLeaves.length > 0) {
			this.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_EASY_KEEP, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	// Refresh the view if open
	async refreshEasyKeepViewIfOpen() {
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
		if (existingLeaves.length > 0) {
			const view = existingLeaves[0].view as EasyKeepView;
			await view.refreshContent();
		}
	}

	// Refresh note thumbnails based on content
	// Refresh note thumbnails based on content
	async refreshThumbnails() {
		for (const note of this.settings.notesDB) {
			const file = this.app.vault.getAbstractFileByPath(note.path);
			if (!(file instanceof TFile)) continue;

			const content = await this.app.vault.cachedRead(file);
			const lines = content.trim().split("\n").filter(line => line.trim() !== "");

			// Get the first non-empty line (content or image)
			const firstLine = lines.find(line => line.trim() !== "");

			let excerpt = "";
			let imageLink: string | undefined;

			// If the first line contains an embedded image, don't show the thumbnail, just text
			if (firstLine && firstLine.includes("![[") && firstLine.includes("]]")) {
				// Excerpt should just be the content text before the image link
				excerpt = lines.slice(0, 1).join(" ");
			} else {
				// Create excerpt from first lines (up to 2 lines of content)
				if (firstLine) {
					excerpt = firstLine;
					if (lines.length > 1) excerpt += " \u2026"; // Add ellipsis if there are more lines
				}

				// Check if an image is embedded anywhere else in the content (not just the first line)
				const match = content.match(/!\[\[([^\]]+)\]\]/);
				if (match) {
					imageLink = match[1].trim();
					if (imageLink && note.imageLink !== imageLink) {
						note.imageLink = imageLink;
					}
				}
			}

			// Update the note with excerpt and imageLink if found
			if (imageLink) {
				note.imageLink = imageLink;
			}

			if (excerpt) {
				note.excerpt = excerpt;
			}
		}

		await this.saveSettings();
	}



	// Add note to the database
	async addToDatabase(file: TFile) {
		const content = await this.app.vault.cachedRead(file);
		const lines = content.trim().split("\n").filter(line => line.trim() !== "");
		let excerpt = "";
		let imageLink: string | undefined;

		if (/\.(jpg|jpeg|png|webp)$/i.test(file.path)) {
			imageLink = file.path;
		} else {
			const obsidianEmbedMatch = content.match(/!\[\[([^\]]+)\]\]/);
			const markdownImageMatch = content.match(/!\[.*?\]\((.*?)\)/);
			if (obsidianEmbedMatch || markdownImageMatch) {
				imageLink = (obsidianEmbedMatch?.[1] || markdownImageMatch?.[1])?.trim();
			}
		}

		if (!imageLink && lines.length > 0) {
			excerpt = lines.slice(0, 2).join(" ");
			if (lines.length > 2) excerpt = excerpt.trim() + " …";
		}

		const titleWithoutExt = file.name.replace(/\.(md|png|jpg|jpeg|webp)$/i, "");
		const newEntry: NoteEntry = {
			path: file.path,
			title: titleWithoutExt,
			excerpt,
			time: Date.now(),
			imageLink,
		};

		this.settings.notesDB = this.settings.notesDB.filter(entry => entry.path !== file.path);
		this.settings.notesDB.unshift(newEntry);
		await this.saveSettings();
	}

	// Remove note from the database
	async removeFromDatabase(filePath: string) {
		const initialLength = this.settings.notesDB.length;
		this.settings.notesDB = this.settings.notesDB.filter(entry => entry.path !== filePath);
		if (this.settings.notesDB.length !== initialLength) {
			await this.saveSettings();
		}
	}

	// Clean up the database by removing notes that no longer exist
	async cleanDatabase() {
		const files = this.app.vault.getMarkdownFiles();
		const existingPaths = new Set(files.map(file => file.path));
		this.settings.notesDB = this.settings.notesDB.filter(entry => existingPaths.has(entry.path));
		await this.saveSettings();
	}

	// Open a note in a new tab
	async openNoteInNewTab(filePath: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;
		let existingLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view.getViewType() === "markdown" && (leaf.view as any).file?.path === filePath) {
				existingLeaf = leaf;
			}
		});
		if (existingLeaf) {
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		} else {
			const newLeaf = this.app.workspace.getLeaf(true);
			await newLeaf.openFile(file);
			this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
		}
	}

	// Load settings from storage
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// Save settings to storage
	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Generate a unique name for an untitled note
	generateUniqueUntitledName(): string {
		const baseName = "Untitled";
		const files = this.app.vault.getMarkdownFiles();
		const existingNames = new Set(files.map(f => f.basename));

		if (!existingNames.has(baseName)) {
			return baseName;
		}

		let counter = 1;
		while (existingNames.has(`${baseName} ${counter}`)) {
			counter++;
		}
		return `${baseName} ${counter}`;
	}

	// Create a new note
	async createNewNote() {
		const title = this.generateUniqueUntitledName();
		const filePath = `${title}.md`;
		const file = await this.app.vault.create(filePath, "");
		await this.addToDatabase(file);
		this.openNoteInNewTab(filePath);
	}
}
