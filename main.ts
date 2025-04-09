import {
	App,
	Plugin,
	Notice,
	WorkspaceLeaf,
	ItemView,
	TFile,
	PluginSettingTab,
	Setting,
} from "obsidian";

const VIEW_TYPE_EASY_KEEP = "easy-keep-view";

interface NoteEntry {
	path: string;
	title: string;
	excerpt: string;
	time: number;
	imagePath?: string;
}

interface MyPluginSettings {
	mySetting: string;
	notesDB: NoteEntry[];
	themeMode: "system" | "light" | "dark";
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: "default",
	notesDB: [],
	themeMode: "system",
};

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

	buildContent() {
		this.mainContainer.empty();
		this.mainContainer.style.overflowY = "auto";
		this.mainContainer.style.height = "100%";

		const cardContainer = this.mainContainer.createDiv("easy-keep-cards-container");

		const newNoteCard = cardContainer.createDiv("easy-keep-card new-note-card");
		newNoteCard.createEl("h3", { text: "+" });
		newNoteCard.createEl("p", { text: "Add New Note" });

		newNoteCard.onclick = () => {
			this.plugin.createNewNote();
		};

		let notes = this.plugin.settings.notesDB.slice().sort((a, b) => b.time - a.time).slice(0, 20);

		if (notes.length) {
			notes.forEach(note => {
				const card = cardContainer.createDiv("easy-keep-card");
				card.createEl("h3", { text: note.title });

				if (note.imagePath) {
					const resourcePath = this.app.vault.adapter.getResourcePath(note.imagePath);
					const img = card.createEl("img", { cls: "easy-keep-thumbnail" });
					img.src = resourcePath;

					img.onerror = () => {
						img.remove();
						if (note.excerpt) {
							card.createEl("p", { text: note.excerpt });
						}
					};

					img.onload = () => {
						console.log(`[Render] Image loaded: ${resourcePath}`);
					};
				} else {
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

		this.injectCSS();
	}

	refreshContent() {
		this.buildContent();
	}

	async onOpen() {
		this.mainContainer = this.containerEl;
		this.buildContent();
	}

	async onClose() {}

	injectCSS() {
		const existingStyle = document.getElementById("easy-keep-css");
		if (existingStyle) existingStyle.remove();

		let bgColor = "#f9f9f9";
		let borderColor = "#ddd";
		let textColor = "#555";
		const theme = this.plugin.settings.themeMode;

		if (theme === "dark" || (theme === "system" && document.body.hasClass("theme-dark"))) {
			bgColor = "#333";
			borderColor = "#555";
			textColor = "#ccc";
		}

		const style = document.createElement("style");
		style.id = "easy-keep-css";
		style.innerText = `
		.easy-keep-cards-container {
			display: flex;
			flex-wrap: wrap;
			gap: 16px;
			padding: 10px;
		}
		.easy-keep-card {
			width: 250px;
			min-height: 150px;
			padding: 16px;
			border: 1px solid ${borderColor};
			border-radius: 8px;
			background-color: ${bgColor};
			box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
			cursor: pointer;
			color: ${textColor};
			display: flex;
			flex-direction: column;
			justify-content: space-between;
		}
		.easy-keep-card h3 {
			font-size: 18px;
			margin-bottom: 8px;
		}
		.easy-keep-card p {
			font-size: 14px;
			color: ${textColor};
			overflow: hidden;
			text-overflow: ellipsis;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			margin: 0;
		}
		.easy-keep-thumbnail {
			max-width: 100%;
			max-height: 100px;
			object-fit: cover;
			border-radius: 4px;
			margin-top: 8px;
			display: block;
		}
		.new-note-card {
			width: 250px;
			height: 150px;
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: ${bgColor};
			border: 2px dashed ${borderColor};
			cursor: pointer;
		}
		.no-history-message {
			font-size: 20px;
			color: ${textColor};
			text-align: center;
			padding: 20px;
			width: 100%;
		}
		`;
		document.head.appendChild(style);
	}
}

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
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		await this.cleanDatabase();

		this.registerView(VIEW_TYPE_EASY_KEEP, (leaf) => new EasyKeepView(leaf, this));

		const ribbonIconEl = this.addRibbonIcon("dice", "Easy Keep View", () => {
			this.activateEasyKeepView();
		});
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		this.registerEvent(this.app.workspace.on("file-open", async (file) => {
			if (file) {
				await this.addToDatabase(file);
				this.refreshEasyKeepViewIfOpen();
			}
		}));

		this.registerEvent(this.app.vault.on("delete", async (file) => {
			if (file instanceof TFile) {
				await this.removeFromDatabase(file.path);
				this.refreshEasyKeepViewIfOpen();
			}
		}));

		this.registerEvent(this.app.vault.on("rename", async (file, oldPath) => {
			if (file instanceof TFile) {
				const entryIndex = this.settings.notesDB.findIndex(e => e.path === oldPath);
				if (entryIndex !== -1) {
					this.settings.notesDB[entryIndex].path = file.path;
					this.settings.notesDB[entryIndex].title = file.basename;
					await this.saveSettings();
					this.refreshEasyKeepViewIfOpen();
				}
			}
		}));

		this.registerEvent(this.app.vault.on("rename", async (file, oldPath) => {
			if (file instanceof TFile) {
				// Update renamed note file
				const entryIndex = this.settings.notesDB.findIndex(e => e.path === oldPath);
				if (entryIndex !== -1) {
					this.settings.notesDB[entryIndex].path = file.path;
					this.settings.notesDB[entryIndex].title = file.basename;
					await this.saveSettings();
					this.refreshEasyKeepViewIfOpen();
				}

				// Update renamed image file
				if (/\.(jpg|jpeg|png|webp)$/i.test(file.path)) {
					let updated = false;
					this.settings.notesDB.forEach(entry => {
						if (entry.imagePath === oldPath) {
							entry.imagePath = file.path;
							updated = true;
						}
					});
					if (updated) {
						await this.saveSettings();
						this.refreshEasyKeepViewIfOpen();
					}
				}
			}
		}));

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_EASY_KEEP);
	}

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

	refreshEasyKeepViewIfOpen() {
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
		if (existingLeaves.length > 0) {
			const view = existingLeaves[0].view as EasyKeepView;
			view.refreshContent();
		}
	}

	async addToDatabase(file: TFile) {
		const content = await this.app.vault.cachedRead(file);
		const lines = content.trim().split("\n").filter(line => line.trim() !== "");
		let excerpt = "";
		let imagePath: string | undefined;

		if (/\.(jpg|jpeg|png|webp)$/i.test(file.path)) {
			imagePath = file.path;
		} else {
			const imageMatch = content.match(/!\[.*?\]\((.*?)\)|\!\[\[(.*?)\]\]/i);
			if (imageMatch) {
				imagePath = imageMatch[1] || imageMatch[2];
				if (imagePath && !imagePath.startsWith("http") && !imagePath.startsWith("/")) {
					const fileFolder = file.path.substring(0, file.path.lastIndexOf("/"));
					imagePath = `${fileFolder}/${imagePath}`.replace(/\/+/g, "/");
				}
				const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
				if (!(imageFile instanceof TFile && /\.(jpg|jpeg|png|webp)$/i.test(imagePath))) {
					imagePath = undefined;
				}
			}
		}

		if (!imagePath && lines.length > 0) {
			excerpt = lines.slice(0, 2).join(" ");
			if (lines.length > 2) excerpt = excerpt.trim() + " …";
		}

		const titleWithoutExt = file.name.replace(/\.(md|png|jpg|jpeg|webp)$/i, "");
		const newEntry: NoteEntry = {
			path: file.path,
			title: titleWithoutExt,
			excerpt,
			time: Date.now(),
			imagePath,
		};

		this.settings.notesDB = this.settings.notesDB.filter(entry => entry.path !== file.path);
		this.settings.notesDB.unshift(newEntry);
		await this.saveSettings();
	}

	async removeFromDatabase(filePath: string) {
		const initialLength = this.settings.notesDB.length;
		this.settings.notesDB = this.settings.notesDB.filter(entry => entry.path !== filePath);
		if (this.settings.notesDB.length !== initialLength) {
			await this.saveSettings();
		}
	}

	async cleanDatabase() {
		const files = this.app.vault.getMarkdownFiles();
		const existingPaths = new Set(files.map(file => file.path));
		this.settings.notesDB = this.settings.notesDB.filter(entry => existingPaths.has(entry.path));
		await this.saveSettings();
	}

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

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async createNewNote() {
		const fileName = `New Note ${Date.now()}.md`;
		const filePath = `/${fileName}`;
		const file = await this.app.vault.create(filePath, `# ${fileName}\n`);
		await this.addToDatabase(file);
		this.refreshEasyKeepViewIfOpen();
		const newLeaf = this.app.workspace.getLeaf(true);
		await newLeaf.openFile(file);
		this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
	}
}
