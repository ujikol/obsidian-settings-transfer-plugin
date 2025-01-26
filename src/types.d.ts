declare global {
    interface Window {
        showOpenFilePicker: (options?: { types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<any[]>;
    }
}

declare module "obsidian" {
    interface App {
        plugins: {
            plugins: { [key: string]: any };
        };
    }
}

export {}; 