🐫 **Welcome to Eigent!** 🐫

Thank you for your interest in contributing to the Eigent project! 🎉 We're excited to have your support. As an open-source product build on CAMEL in a rapidly evolving and open-ended field, we wholeheartedly welcome contributions of all kinds. Whether you want to introduce new features, enhance the infrastructure, improve documentation, asking issues, or fix bugs, we appreciate your enthusiasm and efforts. 🙌  You are welcome to join our [discord](https://discord.camel-ai.org/) for more efficient communication. 💬

## Join Our Community 🌍

### Developer Meeting Time & Link 💻
- English speakers: Mondays at 8 PM PDT. Join via Discord: [Meeting Link](https://meet.google.com/sez-aomy-ebm?authuser=0&hs=122&ijlm=1753634732982)
- Chinese Speakers: Mondays at 9 PM UTC+8. Join via TecentMeeting: [Meeting Link](https://meeting.tencent.com/dm/057wap1eeCSY)

### Our Communication Channels 💬
- **Discord:** [Join here](https://discord.camel-ai.org/)
- **WeChat:** Scan the QR code [here](https://ghli.org/camel/wechat.png)
- **Slack:** [Join here](https://join.slack.com/t/camel-ai/shared_invite/zt-2g7xc41gy-_7rcrNNAArIP6sLQqldkqQ)

## Guidelines 📝

### Contributing to the Code 👨‍💻👩‍💻

If you're eager to contribute to this project, that's fantastic! We're thrilled to have your support. 

- If you are a contributor from the community:
  - Follow the [Fork-and-Pull-Request](https://docs.github.com/en/get-started/quickstart/contributing-to-projects) workflow when opening your pull requests.
- If you are a member of [CAMEL-AI.org](https://github.com/camel-ai):
  - Follow the [Checkout-and-Pull-Request](https://dev.to/ceceliacreates/how-to-create-a-pull-request-on-github-16h1) workflow when opening your pull request; this will allow the PR to pass all tests that require [GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets).

Make sure to mention any related issues and tag the relevant maintainers too. 💪

Before your pull request can be merged, it must pass the formatting, linting, and testing checks. You can find instructions on running these checks locally under the **Common Actions** section below. 🔍

Ensuring excellent documentation and thorough testing is absolutely crucial. Here are some guidelines to follow based on the type of contribution you're making:

- If you fix a bug:
  - Add a relevant unit test when possible. These can be found in the `test` directory.
- If you make an improvement:
  - Update any affected example console scripts in the `examples` directory, Gradio demos in the `apps` directory, and documentation in the `docs` directory.
  - Update unit tests when relevant.
- If you add a feature:
  - Include unit tests in the `test` directory. 
  - Add a demo script in the `examples` directory.
 
We're a small team focused on building great things. If you have something in mind that you'd like to add or modify, opening a pull request is the ideal way to catch our attention. 🚀

### Contributing to Code Reviews 🔍
This part outlines the guidelines and best practices for conducting code reviews in Eigent. The aim is to ensure that all contributions are of high quality, align with the project's goals, and are consistent with our coding standards.

#### Purpose of Code Reviews
- Maintain Code Quality: Ensure that the codebase remains clean, readable, and maintainable.
- Knowledge Sharing: Facilitate knowledge sharing among contributors and help new contributors learn best practices.
- Bug Prevention: Catch potential bugs and issues before they are merged into the main branch.
- Consistency: Ensure consistency in style, design patterns, and architecture across the project.

#### Review Process Overview
- Reviewers should check the code for functionality, readability, consistency, and compliance with the project’s coding standards.
- If changes are necessary, the reviewer should leave constructive feedback.
- The contributor addresses feedback and updates the PR.
- The reviewer re-reviews the updated code.
- Once the code is approved by at least two reviewer, it can be merged into the main branch.
- Merging should be done by a maintainer or an authorized contributor.

#### Code Review Checklist
- Functionality
  - Correctness: Does the code perform the intended task? Are edge cases handled?
  - Testing: Is there sufficient test coverage? Do all tests pass?
  - Security: Are there any security vulnerabilities introduced by the change?
  - Performance: Does the code introduce any performance regressions?

- Code Quality
  - Readability: Is the code easy to read and understand? Is it well-commented where necessary?
  - Maintainability: Is the code structured in a way that makes future changes easy?
  - Style: Does the code follow the project’s style guidelines?
  Currently we use Ruff for format check and take [Google Python Style Guide]("https://google.github.io/styleguide/pyguide.html") as reference.
  - Documentation: Are public methods, classes, and any complex logic well-documented?
- Design
  - Consistency: Does the code follow established design patterns and project architecture?
  - Modularity: Are the changes modular and self-contained? Does the code avoid unnecessary duplication?
  - Dependencies: Are dependencies minimized and used appropriately?

#### Reviewer Responsibilities
- Timely Reviews: Reviewers should strive to review PRs promptly to keep the project moving.
- Constructive Feedback: Provide feedback that is clear, constructive, and aimed at helping the contributor improve.
- Collaboration: Work with the contributor to address any issues and ensure the final code meets the project’s standards.
- Approvals: Only approve code that you are confident meets all the necessary criteria.

#### Common Pitfalls
- Large PRs: Avoid submitting PRs that are too large. Break down your changes into smaller, manageable PRs if possible.
- Ignoring Feedback: Address all feedback provided by reviewers, even if you don’t agree with it—discuss it instead of ignoring it.
- Rushed Reviews: Avoid rushing through reviews. Taking the time to thoroughly review code is critical to maintaining quality.

Code reviews are an essential part of maintaining the quality and integrity of our open source project. By following these guidelines, we can ensure that Eigent remains robust, secure, and easy to maintain, while also fostering a collaborative and welcoming community.

### Guideline for Writing Docstrings

This guideline will help you write clear, concise, and structured docstrings for contributing to `Eigent`.

#### 1. Use the Triple-Quoted String with `r"""` (Raw String)
Begin the docstring with `r"""` to indicate a raw docstring. This prevents any issues with special characters and ensures consistent formatting.

#### 2. Provide a Brief Class or Method Description
- Start with a concise summary of the purpose and functionality.
- Keep each line under `79` characters.
- The summary should start on the first line without a linebreak.

Example:
```python
r"""Class for managing conversations of CAMEL Chat Agents.
"""
```

#### 3. Document Parameters in the Args Section
- Use an `Args`: section for documenting constructor or function parameters.
- Maintain the `79`-character limit for each line, and indent continuation lines by 4 spaces.
- Follow this structure:
  - Parameter Name: Match the function signature.
  - Type: Include the type (e.g., `int`, `str`, custom types like `BaseModelBackend`).
  - Description: Provide a brief explanation of the parameter's role.
  - Default Value: Use (`default: :obj:<default_value>`) to indicate default values.

Example:
```markdown
Args:
    system_message (BaseMessage): The system message for initializing 
        the agent's conversation context.
    model (BaseModelBackend, optional): The model backend to use for 
        response generation. Defaults to :obj:`OpenAIModel` with 
        `GPT_4O_MINI`. (default: :obj:`OpenAIModel` with `GPT_4O_MINI`)
```

### Principles 🛡️

#### Naming Principle: Avoid Abbreviations in Naming

- Abbreviations can lead to ambiguity, especially since variable names and code in CAMEL are directly used by agents.
- Use clear, descriptive names that convey meaning without requiring additional explanation. This improves both human readability and the agent's ability to interpret the code.

Examples:

- Bad: msg_win_sz
- Good: message_window_size

By adhering to this principle, we ensure that CAMEL remains accessible and unambiguous for both developers and AI agents.

### Board Item Create Workflow 🛠️
At Eigent, we manage our project through a structured workflow that ensures efficiency and clarity in our development process. Our workflow includes stages for issue creation and pull requests (PRs), sprint planning, and reviews.

#### Issue Item Stage:
Our [issues](https://github.com/eigent-ai/Eigent-desktop/issues) page on GitHub is regularly updated with bugs, improvements, and feature requests. We have a handy set of labels to help you sort through and find issues that interest you. Feel free to use these labels to keep things organized.

When you start working on an issue, please assign it to yourself so that others know it's being taken care of.

When creating a new issue, it's best to keep it focused on a specific bug, improvement, or feature. If two issues are related or blocking each other, it's better to link them instead of merging them into one.

We do our best to keep these issues up to date, but considering the fast-paced nature of this field, some may become outdated. If you come across any such issues, please give us a heads-up so we can address them promptly. 👀

Here’s how to engage with our issues effectively:
- Go to [GitHub Issues](https://github.com/eigent-ai/Eigent-desktop/issues), create a new issue, choose the category, and fill in the required information.
- Ensure the issue has a proper title and update the Assignees, Labels, Projects (select Backlog status), Development, and Milestones.
- Discuss the issue during team meetings, then move it to the Analysis Done column.
- At the beginning of each sprint, share the analyzed issue and move it to the Sprint Planned column if you are going to work on this issue in the sprint.

#### Pull Request Item Stage:

- Go to [GitHub Pulls](https://github.com/eigent-ai/Eigent-desktop/pulls), create a new PR, choose the branch, and fill in the information, linking the related issue.
- Ensure the PR has a proper title and update the Reviewers (convert to draft), Assignees, Labels, Projects (select Developing status), Development, and Milestones.
- If the PR is related to a roadmap, link the roadmap to the PR.
- Move the PR item through the stages: Developing, Stuck, Reviewing (click ready for review), Merged. The linked issue will close automatically when the PR is merged.

**Labeling PRs:**
- **feat**: For new features (e.g., `feat: Add new AI model`)
- **fix**: For bug fixes (e.g., `fix: Resolve memory leak issue`)
- **docs**: For documentation updates (e.g., `docs: Update contribution guidelines`)
- **style**: For code style changes (e.g., `style: Refactor code formatting`)
- **refactor**: For code refactoring (e.g., `refactor: Optimize data processing`)
- **test**: For adding or updating tests (e.g., `test: Add unit tests for new feature`)
- **chore**: For maintenance tasks (e.g., `chore: Update dependencies`)

### Getting Help 🆘

Our aim is to make the developer setup as straightforward as possible. If you encounter any challenges during the setup process, don't hesitate to reach out to a maintainer. We're here to assist you and ensure that the experience is smooth not just for you but also for future contributors. 😊

## Quick Start 🚀

```bash
git clone https://github.com/eigent-ai/Eigent-desktop.git
cd Eigent-desktop
npm install
npm run dev
```

## Common Actions 🔄

### Update dependencies

Whenever you add, update, or delete any dependencies in `pyproject.toml`, please run `uv lock` to synchronize the dependencies with the lock file.

## Giving Credit 🎉

If your contribution has been included in a release, we'd love to give you credit on Twitter, but only if you're comfortable with it!

If you have a Twitter account that you would like us to mention, please let us know either in the pull request or through another communication method. We want to make sure you receive proper recognition for your valuable contributions. 😄
