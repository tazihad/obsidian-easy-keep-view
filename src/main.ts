import { App, Plugin, WorkspaceLeaf, ItemView, TFile, debounce } from "obsidian";
import { DEFAULT_SETTINGS, EasySettingTab, NoteEntry, EasyKeepViewPluginSettings } from "./settings";  // Import from settings
const VIEW_TYPE_EASY_KEEP = "easy-keep-view";

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



class EasyKeepView extends ItemView {
    plugin: EasyKeepViewPlugin;
    private mainContainer: HTMLElement;
    private cardContainer: HTMLElement | null = null;
    private cards: Map<string, HTMLElement> = new Map(); // Cache cards by note path

    constructor(leaf: WorkspaceLeaf, plugin: EasyKeepViewPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_EASY_KEEP;
    }

    getDisplayText(): string {
        return "Easy Keep View";
    }

    // Build or update a single note card
    private createOrUpdateCard(note: NoteEntry): HTMLElement {
        let card = this.cards.get(note.path);
        if (!card) {
            card = this.cardContainer!.createDiv("easy-keep-card");
            this.cards.set(note.path, card);
        } else {
            card.empty(); // Clear existing content for update
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
        } else if (note.excerpt) {
            card.createEl("p", { text: note.excerpt });
        }

        // Use addEventListener instead of onclick to fix TypeScript error
        card.addEventListener('click', () => this.plugin.openNoteInNewTab(note.path));

        return card;
    }

    // Build the content of the view
    async buildContent() {
        this.mainContainer.addClass("easy-keep-view-main");
        if (!this.cardContainer) {
            this.cardContainer = this.mainContainer.createDiv("easy-keep-cards-container");
            this.plugin.applyTheme();
        } else {
            // Clear existing cards except new-note-card to prevent duplicates
            const existingCards = this.cardContainer.querySelectorAll(".easy-keep-card:not(.new-note-card)");
            existingCards.forEach(card => card.remove());
        }

        // New Note Card (always first)
        let newNoteCard = this.cardContainer.querySelector(".new-note-card");
        if (!newNoteCard) {
            newNoteCard = this.cardContainer.createDiv("easy-keep-card new-note-card");
            newNoteCard.createEl("h3", { text: "+" });
            newNoteCard.createEl("p", { text: "Add New Note" });
            newNoteCard.addEventListener('click', () => this.plugin.createNewNote());
        }
        // Ensure newNoteCard is the first child
        this.cardContainer.insertBefore(newNoteCard, this.cardContainer.firstChild);

        // Refresh thumbnails in the background
        await this.plugin.refreshThumbnails();

        const notes = this.plugin.settings.notesDB
            .slice()
            .sort((a, b) => b.time - a.time)
            .slice(0, 100);

        // Update or create cards for existing notes
        const currentPaths = new Set<string>();
        notes.forEach(note => {
            currentPaths.add(note.path);
            const card = this.createOrUpdateCard(note);
            // Append after newNoteCard
            this.cardContainer!.appendChild(card);
        });

        // Remove cards for notes that no longer exist
        for (const [path, card] of this.cards) {
            if (!currentPaths.has(path)) {
                card.remove();
                this.cards.delete(path);
            }
        }

        // Show "No notes" message if needed
        let noHistory = this.cardContainer.querySelector(".no-history-message");
        if (notes.length === 0) {
            if (!noHistory) {
                noHistory = this.cardContainer.createDiv("no-history-message");
                noHistory.setText("No notes, create a new one!");
                // Insert after newNoteCard
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

    // Incremental refresh of the content
    async refreshContent() {
        if (!this.cardContainer) {
            await this.buildContent();
            return;
        }
        await this.buildContent(); // Reuses existing cards
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
        this.applyTheme();

        this.registerView(VIEW_TYPE_EASY_KEEP, (leaf) => new EasyKeepView(leaf, this));

        this.app.workspace.onLayoutReady(async () => {
            await this.cleanDatabase();
            await this.refreshThumbnails(); // Preload thumbnails
            this.refreshEasyKeepViewIfOpen();

            if (this.settings.openAsHomepage) {
                await this.activateEasyKeepView();
            }
        });

        const ribbonIconEl = this.addRibbonIcon("sticky-note", "Easy Keep View", () => {
            this.activateEasyKeepView();
        });
        ribbonIconEl.addClass("my-plugin-ribbon-class");

        // Update database on file-open
        this.registerEvent(this.app.workspace.on("file-open", async (file) => {
            if (file) {
                await this.addToDatabase(file);
                this.refreshDebounced();
            }
        }));

        // Update database on file deletion
        this.registerEvent(this.app.vault.on("delete", async (file) => {
            if (file instanceof TFile) {
                await this.removeFromDatabase(file.path);
                this.refreshDebounced();
            }
        }));

        // Update database on file rename (notes)
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

        // Update database on file rename (images)
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

        // Update database and thumbnails on file modification
        this.registerEvent(this.app.vault.on("modify", async (file) => {
            if (file instanceof TFile) {
                await this.addToDatabase(file); // Updates notesDB
                await this.refreshThumbnails(); // Updates image links and excerpts
                this.refreshDebounced(); // Refreshes view if open
            }
        }));

        // Initialize debounced refresh
        this.refreshDebounced = debounce(() => this.refreshEasyKeepViewIfOpen(), 300);

        this.addSettingTab(new EasySettingTab(this.app, this));
    }

	// Apply theme based on settings
	applyTheme() {
		const theme = this.settings.themeMode;
		const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
	
		if (existingLeaves.length > 0) {
			const view = existingLeaves[0].view as EasyKeepView;
			const container = view.containerEl;
			const cardContainer = container.querySelector(".easy-keep-cards-container");
	
			if (cardContainer) {
				// Remove all possible theme classes
				cardContainer.removeClass("theme-light", "theme-dark", "theme-system");
	
				// Apply the selected theme
				if (theme === "system") {
					// Detect Obsidian's current theme
					const isDark = document.body.hasClass("theme-dark");
					cardContainer.addClass(isDark ? "theme-dark" : "theme-light");
				} else {
					cardContainer.addClass(`theme-${theme}`);
				}
			}
		}
	
		// Optionally set data-theme on <html> for broader compatibility (not required for this fix)
		if (theme === "system") {
			document.documentElement.removeAttribute("data-theme");
		} else {
			document.documentElement.setAttribute("data-theme", theme);
		}
	}

	// Activate the view
	// Activate the view
    async activateEasyKeepView() {
        const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EASY_KEEP);
        if (existingLeaves.length > 0) {
            const leaf = existingLeaves[0];
            this.app.workspace.revealLeaf(leaf);
    
            // Ensure the view is refreshed before scrolling
            const view = leaf.view as EasyKeepView;
            await view.refreshContent();
    
            // Scroll after DOM is refreshed
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
	
		// Check if the note is already open in a leaf
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view.getViewType() === "markdown" && (leaf.view as any).file?.path === filePath) {
				existingLeaf = leaf;
			}
		});
	
		if (existingLeaf) {
			// If the note is already open, just set it as the active leaf
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		} else {
			// Otherwise, open it in a new leaf
			const newLeaf = this.app.workspace.getLeaf(true);
			await newLeaf.openFile(file);  // Open the file directly
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