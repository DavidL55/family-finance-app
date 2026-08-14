# Family Finance App — Project Instructions

## Team Agents

The personas (Lola, Sun, Boris, Ofra, Nami, Sasha) live in the **`aniccai-personas`** plugin — their constant personality is shared across all Aniccai projects. Each persona's **Family-Finance-App-specific** flavor (stack, patterns, anti-patterns) lives in `.claude/personas/<name>.md` and is loaded automatically when that persona is invoked.

| Persona   | Lens         | Invoke for                                                        |
|-----------|--------------|-------------------------------------------------------------------|
| **Lola**  | Product      | scope, priorities, "should we build X", success metrics            |
| **Sun**   | Architecture | system boundaries, cross-agent plan review, the pre-code TDD       |
| **Boris** | Tech Lead    | implementation approach, code quality, tradeoffs, Gemini pipelines |
| **Ofra**  | UX           | layout, responsive, interaction patterns, a11y, Hebrew RTL         |
| **Nami**  | Ship         | deploy strategy, branch/PR flow, production safety                 |
| **Sasha** | Security     | Firestore rules, secrets, Google OAuth scopes                      |

Only Lola and Boris have project flavor files so far; the others run on their base persona until this project gives them something specific to say.
