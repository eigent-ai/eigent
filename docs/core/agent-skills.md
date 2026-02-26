---
title: "Agent Skills"
description: "Learn how to use built-in and custom Agent Skills in Eigent."
---

# Agent Skills

Agent Skills, a concept originally introduced by Anthropic, are modular capabilities designed to expand Eigent’s core capabilities. 

Each Skill acts as a specialized package containing instructions, metadata, and optional tools (such as scripts or templates) that Eigent automatically triggers whenever relevant to a task.

## The Value of Using Skills

While traditional prompts act as one-off instructions for a single conversation, Skills are persistent, file-based assets that provide Eigent with deep, domain-specific expertise.

By supplying tailored workflows, context, and best practices, Skills transform a general-purpose AI into a dedicated specialist.

Because they load seamlessly on demand, you never have to waste time copy-pasting the same instructions across multiple chats.

**Key benefits**:

- **Specialize Eigent**: Tailor capabilities for domain-specific tasks
- **Reduce repetition**: Create once, use automatically
- **Compose capabilities**: Combine Skills to build complex workflows

## Using Skills in Eigent

Eigent provides pre-built Agent Skills for common tasks, and you can create or upload your own custom Skills. Eigent automatically uses them when relevant to your request.

- **Example Skills:** These are pre-built Agent Skills available to all users on Eigent. They operate seamlessly behind the scenes, and Eigent utilizes them without requiring any manual setup. You have the option to manually enable or disable it.

    [skills 04.mov](/docs/images/agent_skills_example_skills_04.mov)

- **Custom Skills:** These allow you to package your specific domain expertise and organizational knowledge. They are available across your Eigent workforce, and you can assign them to specific agents. You can create them directly within the Skill interface or add them via Eigent's settings.

    ![Screenshot 2026-02-24 at 21.58.11.png](/docs/images/agent_skills_settings_screenshot.png)

Upload your own Skills as zip files through Homepage > Agents > Skills. Custom Skills are individual to each user and saved locally.

[skill01.mov](/docs/images/agent_skills_skill01.mov)

You can upload a standalone `SKILL.md` file or a complete `.zip` skill package. If uploading a package, it must contain a `SKILL.md` file in its root directory. In either case, the `SKILL.md` file must define the Skill's name and description using YAML formatting.

[skill02.mov](/docs/images/agent_skills_skill02.mov)

Every Skill requires a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: your-skill-name
description: Brief description of what this Skill does and when to use it
---

# Your Skill Name

## Instructions
[Clear, step-by-step guidance for Eigent to follow]

## Examples
[Concrete examples of using this Skill]
```

Eigent supports uploading multiple skills within one zip file, but please ensure the contents of each skill folder are complete.

[skills 05.mov](/docs/images/agent_skills_skills_05.mov)

## Using Skills

To test your Skill file immediately, click the **Try in chat** button.

[skill03.mov](/docs/images/agent_skills_skill03.mov)

Use Skills only from trusted sources. Malicious Skills can misuse tools or execute unintended actions, potentially causing data leaks or unauthorized access—so carefully audit any untrusted Skill before use.
