import { App, Plugin, WorkspaceLeaf, ItemView, TFile, debounce, Notice } from "obsidian";
import { DEFAULT_SETTINGS, EasySettingTab, NoteEntry, EasyKeepViewPluginSettings } from "./settings";  // Import from settings
const VIEW_TYPE_EASY_KEEP = "easy-keep-view";

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

class EasyKeepView extends ItemView {
    plugin: EasyKeepViewPlugin;
    private mainContainer: HTMLElement;
    private cardContainer: HTMLElement | null = null;
    private cards: Map<string, HTMLElement> = new Map();

    constructor(leaf: WorkspaceLeaf, plugin: EasyKeepViewPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_EASY_KEEP;
    }

    getDisplayText(): string {
        return "Easy keep view";
    }

    private createOrUpdateCard(note: NoteEntry): HTMLElement {
        let card = this.cards.get(note.path);
        if (!card) {
            card = this.cardContainer!.createDiv("easy-keep-card");
            this.cards.set(note.path, card);
        } else {
            card.empty();
        }

        card.createEl("h3", { text: note.title });

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
                    img.remove();
                    if (note.excerpt) card.createEl("p", { text: note.excerpt });
                };
                
            } else if (note.excerpt) {
                card.createEl("p", { text: note.excerpt });
            }
        } else if (note.excerpt) {
            card.createEl("p", { text: note.excerpt });
        }

        card.addEventListener('click', () => this.plugin.openNoteInNewTab(note.path));

        return card;
    }

    async buildContent() {
        this.mainContainer.addClass("easy-keep-view-main");
        if (!this.cardContainer) {
            this.cardContainer = this.mainContainer.createDiv("easy-keep-cards-container");
        } else {
            const existingCards = this.cardContainer.querySelectorAll(".easy-keep-card:not(.new-note-card)");
            existingCards.forEach(card => card.remove());
        }

        let newNoteCard = this.cardContainer.querySelector(".new-note-card");
        if (!newNoteCard) {
            newNoteCard = this.cardContainer.createDiv("easy-keep-card new-note-card");
            newNoteCard.createEl("h3", { text: "+" });
            newNoteCard.createEl("p", { text: "Add new note" });
            newNoteCard.addEventListener('click', () => this.plugin.createNewNote());
        }
        this.cardContainer.insertBefore(newNoteCard, this.cardContainer.firstChild);

        await this.plugin.refreshThumbnails();

        const notes = this.plugin.settings.notesDB
            .slice()
            .sort((a, b) => b.time - a.time)
            .slice(0, 100);

        const currentPaths = new Set<string>();
        notes.forEach(note => {
            currentPaths.add(note.path);
            const card = this.createOrUpdateCard(note);
            this.cardContainer!.appendChild(card);
        });

        for (const [path, card] of this.cards) {
            if (!currentPaths.has(path)) {
                card.remove();
                this.cards.delete(path);
            }
        }

        let noHistory = this.cardContainer.querySelector(".no-history-message");
        if (notes.length === 0) {
            if (!noHistory) {
                noHistory = this.cardContainer.createDiv("no-history-message");
                noHistory.setText("No notes, create a new one!");
                if (newNoteCard && newNoteCard.nextSibling) {
                    this.cardContainer.insertBefore(noHistory, newNoteCard.nextSibling);
                } else {
                    this.cardContainer.appendChild(noHistory);
                }
            }
        } else if (noHistory) {
            noHistory.remove();
        }
    }

    async refreshContent() {
        if (!this.cardContainer) {
            await this.buildContent();
            return;
        }
        await this.buildContent();
    }

    async onOpen() {
        this.mainContainer = this.containerEl;
        await this.plugin.loadSettings();
        await this.buildContent();
    }

    async onClose() {
        this.cards.clear();
        this.cardContainer = null;
    }
}

export default class EasyKeepViewPlugin extends Plugin {
	settings: EasyKeepViewPluginSettings;
	private refreshDebounced: () => void;

	async onload() {
        await this.loadSettings();

        this.registerView(VIEW_TYPE_EASY_KEEP, (leaf) => new EasyKeepView(leaf, this));

        this.app.workspace.onLayoutReady(async () => {
            await this.cleanDatabase();
            await this.refreshThumbnails();
            this.refreshEasyKeepViewIfOpen();

            if (this.settings.openAsHomepage) {
                await this.activateEasyKeepView();
            }
        });

        const ribbonIconEl = this.addRibbonIcon("sticky-note", "Easy keep view", () => {
            this.activateEasyKeepView();
        });

        this.addCommand({
            id: "open-easy-keep-view",
            name: "Open easy keep view",
            callback: () => this.activateEasyKeepView(),
        });

        this.addCommand({
            id: "create-easy-keep-note",
            name: "Create New Easy Keep Note",
            callback: () => this.createNewNote(),
        });

        this.registerEvent(this.app.workspace.on("file-open", async (file) => {
            if (file) {
                await this.addToDatabase(file);
                this.refreshDebounced();
            }
        }));

        this.registerEvent(this.app.vault.on("delete", async (file) => {
            if (file instanceof TFile) {
                await this.removeFromDatabase(file.path);
                this.refreshDebounced();
            }
        }));

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

        this.registerEvent(this.app.vault.on("modify", async (file) => {
            if (file instanceof TFile) {
                await this.addToDatabase(file);
                await this.refreshThumbnails();
                this.refreshDebounced();
            }
        }));

        this.refreshDebounced = debounce(() => this.refreshEasyKeepViewIfOpen(), 300);

        this.addSettingTab(new EasySettingTab(this.app, this));
    }

    async activateEasyKeepView() {
        const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
        if (existingLeaves.length > 0) {
            const leaf = existingLeaves[0];
            this.app.workspace.revealLeaf(leaf);
    
            const view = leaf.view as EasyKeepView;
            await view.refreshContent();
    
            requestAnimationFrame(() => {
                const cardContainer = view.containerEl.querySelector(".easy-keep-cards-container");
                if (cardContainer) {
                    cardContainer.scrollTop = 0;
                }
            });
    
            return;
        }
    
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPE_EASY_KEEP, active: true });
        this.app.workspace.revealLeaf(leaf);
    
        const view = leaf.view as EasyKeepView;
        await view.refreshContent();
    
        requestAnimationFrame(() => {
            const cardContainer = view.containerEl.querySelector(".easy-keep-cards-container");
            if (cardContainer) {
                cardContainer.scrollTop = 0;
            }
        });
    }
    
	async refreshEasyKeepViewIfOpen() {
        const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
        if (existingLeaves.length > 0) {
            const view = existingLeaves[0].view as EasyKeepView;
            await view.refreshContent();
        }
    }

	async refreshThumbnails() {
		for (const note of this.settings.notesDB) {
			const file = this.app.vault.getAbstractFileByPath(note.path);
			if (!(file instanceof TFile)) continue;

			const content = await this.app.vault.cachedRead(file);
			const lines = content.trim().split("\n").filter(line => line.trim() !== "");

			const firstLine = lines.find(line => line.trim() !== "");

			let excerpt = "";
			let imageLink: string | undefined;

			if (firstLine && firstLine.includes("![[") && firstLine.includes("]]")) {
				excerpt = lines.slice(0, 1).join(" ");
			} else {
				if (firstLine) {
					excerpt = firstLine;
					if (lines.length > 1) excerpt += " \u2026";
				}

				const match = content.match(/!\[\[([^\]]+)\]\]/);
				if (match) {
					imageLink = match[1].trim();
					if (imageLink && note.imageLink !== imageLink) {
						note.imageLink = imageLink;
					}
				}
			}

			if (imageLink) {
				note.imageLink = imageLink;
			}

			if (excerpt) {
				note.excerpt = excerpt;
			}
		}

		await this.saveSettings();
	}



	async addToDatabase(file: TFile) {
        let excerpt = "";
        let imageLink: string | undefined;
    
        if (/\.(jpg|jpeg|png|webp)$/i.test(file.path)) {
            imageLink = file.path;
        } else {
            const content = await this.app.vault.cachedRead(file);
            const lines = content.trim().split("\n").filter(line => line.trim() !== "");
    
            const obsidianEmbedMatch = content.match(/!\[\[([^\]]+)\]\]/);
            const markdownImageMatch = content.match(/!\[.*?\]\((.*?)\)/);
            if (obsidianEmbedMatch || markdownImageMatch) {
                imageLink = (obsidianEmbedMatch?.[1] || markdownImageMatch?.[1])?.trim();
            }
    
            if (lines.length > 0) {
                excerpt = lines.slice(0, 2).join(" ");
                if (lines.length > 2) excerpt = excerpt.trim() + " …";
            }
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

	async removeFromDatabase(filePath: string) {
		const initialLength = this.settings.notesDB.length;
		this.settings.notesDB = this.settings.notesDB.filter(entry => entry.path !== filePath);
		if (this.settings.notesDB.length !== initialLength) {
			await this.saveSettings();
		}
	}

	async cleanDatabase() {
        const files = this.app.vault.getFiles().filter(file => 
            /\.(md|jpg|jpeg|png|webp)$/i.test(file.path)
        );
        const existingPaths = new Set(files.map(file => file.path));
        this.settings.notesDB = this.settings.notesDB.filter(entry => {
            if (!existingPaths.has(entry.path)) return false;
            if (/\.(jpg|jpeg|png|webp)$/i.test(entry.path)) {
                entry.excerpt = "";
                entry.imageLink = entry.path;
            }
            return true;
        });
        await this.saveSettings();
    }

	async openNoteInNewTab(filePath: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice(`File not found: ${filePath}`);
            return;
        }

        let existingLeaf: WorkspaceLeaf | null = null;

        this.app.workspace.iterateAllLeaves(leaf => {
            const viewType = leaf.view.getViewType();
            const viewState = leaf.view.getState();
            if ((viewType === "markdown" || viewType === "image") && viewState?.file === filePath) {
                existingLeaf = leaf;
            }
        });

        if (existingLeaf) {
            this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
        } else {
            try {
                const newLeaf = this.app.workspace.getLeaf(true);
                await newLeaf.openFile(file);
                this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
            } catch (error) {
                new Notice(`Cannot open ${file.name}: Unsupported format or error.`);
            }
        }
    }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

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

	async createNewNote() {
		const title = this.generateUniqueUntitledName();
		const filePath = `${title}.md`;
		const file = await this.app.vault.create(filePath, "");
		await this.addToDatabase(file);
		this.openNoteInNewTab(filePath);
	}
}