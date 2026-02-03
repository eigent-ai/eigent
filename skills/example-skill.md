# Example Skill

This is an example skill file that demonstrates how to create custom skills for the Eigent AI agent system.

## Purpose

Skills extend the capabilities of AI agents by providing them with specific knowledge or procedures to follow when handling tasks.

## Usage

1. Create a markdown file (.md) with your skill content
2. Upload it through the Skills management interface in Settings > MCP & Tools
3. The skill will be available to agents through the skills-loader MCP server

## Skill Structure

A good skill file should include:

- **Clear Title**: Descriptive name for the skill
- **Purpose**: What the skill is for
- **Instructions**: Step-by-step procedures or knowledge
- **Examples**: Sample usage when applicable
- **Prerequisites**: Any requirements or dependencies

## Example: Web Scraping Skill

When asked to scrape a website:

1. First check if the URL is accessible
2. Respect robots.txt
3. Use appropriate rate limiting
4. Extract relevant data using CSS selectors or XPath
5. Handle errors gracefully
6. Return structured data

## Best Practices

- Keep skills focused on a single task or domain
- Use clear, actionable language
- Include error handling guidance
- Provide examples where helpful
- Update skills as requirements change
