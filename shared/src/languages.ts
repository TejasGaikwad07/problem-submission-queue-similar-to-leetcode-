export const LANGUAGES = ["cpp", "javascript", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface LanguageSpec {
    image: string;
    /** file the source is saved as, inside /judge/src in the container */
    fileName: string;
    /** compile command (runs in its own container), if the language needs one */
    compile?: string[];
    /** command that runs the program; reads the test input from stdin */
    run: string[];
}

export function getLanguageSpec(language: Language): LanguageSpec {
    switch (language) {
        case "cpp":
            return {
                image: process.env.JUDGE_IMAGE_CPP || "gcc:13",
                fileName: "main.cpp",
                compile: ["g++", "-O2", "-std=c++17", "-o", "/judge/bin/main", "/judge/src/main.cpp"],
                run: ["/judge/bin/main"],
            };
        case "javascript":
            return {
                image: process.env.JUDGE_IMAGE_JAVASCRIPT || "node:20-alpine",
                fileName: "main.js",
                run: ["node", "/judge/src/main.js"],
            };
        case "python":
            return {
                image: process.env.JUDGE_IMAGE_PYTHON || "python:3.12-alpine",
                fileName: "main.py",
                run: ["python", "-B", "/judge/src/main.py"],
            };
    }
}
