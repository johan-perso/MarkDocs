# MarkDocs

MarkDocs permet de transformer une collection de fichiers Markdown en une véritable documentation, fonctionnelle et prête à être déployée le plus rapidement.

## Fonctionnement

- Pour créer une documentation, vous aurez besoin d’un ensemble de documents Markdown, vous pouvez les écrire depuis un éditeur dédiée comme [Obsidian](https://obsidian.md) ou depuis un éditeur de texte quelconque.
- Ensuite, utiliser la commande `markdocs init` pour générer un fichier de configuration (`_markdocs/config.jsonc`).
- Compilez vos documents en une documentation avec la commande `markdocs build`.
- Un projet [Fumadocs](https://fumadocs.vercel.app/) sera créé localement dans un dossier temporaire de votre ordinateur, et sera ajustée automatiquement selon vos documents et votre configuration. Vous pourrez le déployer où vous voulez manuellement, ou automatiquement sur Vercel avec l’intégration native.
- Chaque mise à jour de votre projet ne consistera qu’à ré-exécuter un build puis un nouveau déploiement.

Pour plus d’informations sur le projet et son utilisation, consultez [sa propre documentation](https://markdocs.johanstick.fr).

## Crédit et licence

Ce projet utilise [Fumadocs](https://github.com/fuma-nama/fumadocs) pour l’entièreté du frontend.
Licence MIT. Développé par [Johan](https://johanstick.fr). Soutenez moi via [Ko-Fi](https://ko-fi.com/johan_stickman) ou [PayPal](https://paypal.me/moipastoii) si vous souhaitez m'aider !