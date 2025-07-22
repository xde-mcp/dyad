import type { Template, ApiTemplate } from "../../shared/templates";

export const DEFAULT_TEMPLATE_ID = "react";

export const localTemplatesData: Template[] = [
  {
    id: "react",
    title: "React.js Template",
    description: "Uses React.js, Vite, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/5b700eab-b28c-498e-96de-8649b14c16d9",
    isOfficial: true,
  },
  {
    id: "next",
    title: "Next.js Template",
    description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
    imageUrl:
      "https://github.com/user-attachments/assets/96258e4f-abce-4910-a62a-a9dff77965f2",
    githubUrl: "https://github.com/dyad-sh/nextjs-template",
    isOfficial: true,
  },
];

// In-memory cache for API templates
let apiTemplatesCache: Template[] | null = null;
let apiTemplatesFetchPromise: Promise<Template[]> | null = null;

// Convert API template to our Template interface
function convertApiTemplate(apiTemplate: ApiTemplate): Template {
  return {
    id: `${apiTemplate.githubOrg}-${apiTemplate.githubRepo}`,
    title: apiTemplate.title,
    description: apiTemplate.description,
    imageUrl: apiTemplate.imageUrl,
    githubUrl: `https://github.com/${apiTemplate.githubOrg}/${apiTemplate.githubRepo}`,
    isOfficial: false,
  };
}

// Fetch templates from API with caching
export async function fetchApiTemplates(): Promise<Template[]> {
  // Return cached data if available
  if (apiTemplatesCache) {
    return apiTemplatesCache;
  }

  // Return existing promise if fetch is already in progress
  if (apiTemplatesFetchPromise) {
    return apiTemplatesFetchPromise;
  }

  // Start new fetch
  apiTemplatesFetchPromise = (async (): Promise<Template[]> => {
    try {
      const response = await fetch("https://api.dyad.sh/v1/templates");
      if (!response.ok) {
        throw new Error(
          `Failed to fetch templates: ${response.status} ${response.statusText}`,
        );
      }

      const apiTemplates: ApiTemplate[] = await response.json();
      const convertedTemplates = apiTemplates.map(convertApiTemplate);

      // Cache the result
      apiTemplatesCache = convertedTemplates;
      return convertedTemplates;
    } catch (error) {
      console.error("Failed to fetch API templates:", error);
      // Reset the promise so we can retry later
      apiTemplatesFetchPromise = null;
      return []; // Return empty array on error
    }
  })();

  return apiTemplatesFetchPromise;
}

// Get all templates (local + API)
export async function getAllTemplates(): Promise<Template[]> {
  const apiTemplates = await fetchApiTemplates();
  return [...localTemplatesData, ...apiTemplates];
}

// Get templates synchronously (only local templates)
export function getLocalTemplates(): Template[] {
  return localTemplatesData;
}

export function getTemplateOrThrow(templateId: string): Template {
  const template = localTemplatesData.find(
    (template) => template.id === templateId,
  );
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }
  return template;
}

export async function getTemplateOrThrowAsync(
  templateId: string,
): Promise<Template> {
  const allTemplates = await getAllTemplates();
  const template = allTemplates.find((template) => template.id === templateId);
  if (!template) {
    throw new Error(`Template ${templateId} not found`);
  }
  return template;
}
