var fs = require("fs")
var path = require("path")

function determineCalloutTitle(type){
	var calloutTitle = ""

	switch(type){
	case "warn":
	case "caution":
	case "attention":
		calloutTitle = "Avertissement"
		break
	case "error":
	case "danger":
		calloutTitle = "Problème"
		break
	case "failure":
	case "fail":
	case "missing":
		calloutTitle = "Échec"
		break
	case "tip":
		calloutTitle = "Astuce"
		break
	case "faq":
		calloutTitle = "Question fréquente"
		break
	case "question":
	case "help":
		calloutTitle = "Question"
		break
	case "success":
	case "check":
	case "done":
		calloutTitle = "Succès"
		break
	case "todo":
	case "hint":
	case "important":
		calloutTitle = "À faire"
		break
	case "example":
		calloutTitle = "Exemple"
		break
	default:
		calloutTitle = ""
		break
	}

	return calloutTitle
}

// Convertir un document Markdown en objet JSON, qu'on pourra traiter par la suite
/**
 * Convertir un document Markdown, en comprenant la syntaxe selon son origine
 * @param {String} content Contenu du document Markdown
 * @param {String} options.origin default | obsidian Éditeur avec lequel le document a été créé
 * @param {String} options.assetsPath Chemin vers le dossier contenant les images et autres fichiers attachés
 * @returns {Object}
*/
module.exports.convertMarkdown = async (
	content,
	options = {
		origin: "default",
		assetsPath: null,
		renameAssets: false
	}
) => {
	const contentObject = {
		warns: [],
		images: [],
		imports: [],
		metadata: {},
		content: ""
	}

	const lines = content.split("\n")
	let currentAction = ""
	let currentActionHistory = []

	function currentAction_set(action){
		if(currentAction == action) return false
		currentActionHistory.push(action)
		currentAction = action
		return true
	}

	function currentAction_precedent(){
		if(!currentActionHistory.length) currentAction = ""
		else {
			currentActionHistory = currentActionHistory.slice(0, -1)
			currentAction = currentActionHistory[currentActionHistory.length - 1]
		}
		return true
	}

	// Faire les modifications en passant sur chaque ligne
	for (let i = 0; i < lines.length; i++) {
		var line = lines[i]

		if(line == "----"){
			contentObject.content += "----" // (séparateur, on le modifie pas, mais avec le "continue" ça fait en sorte qu'on le considérera pas comme un séparateur dans la suite du code)
			continue
		}

		if(currentAction != "codeblock" && currentAction != "custom-component" && line.trim().startsWith("```") && !line.trim().startsWith("```component")){
			currentAction_set("codeblock")
			contentObject.content += `${line}\n`
			continue
		}
		if(currentAction == "codeblock" && line.trim().startsWith("```")){
			currentAction_precedent()
			contentObject.content += `${line}\n`
			continue
		}

		if(currentAction == "codeblock"){ // on ne fais pas de modifs dans les codeblock
			contentObject.content += `${line}\n`
			continue
		}

		if(currentAction != "metadata" && line.trim() == "---" && !Object.keys(contentObject.metadata).length){
			currentAction_set("metadata")
			continue
		}
		if(currentAction == "metadata" && line.trim() == "---"){
			currentAction_precedent()
			continue
		}

		if(currentAction == "metadata"){
			const key = line.split(":")[0].trim()
			const value = line.split(":").slice(1).join(":").trim()
			contentObject.metadata[key] = value
			continue
		}

		// ========= Actions qui modifient potentiellement le contenu

		// images attachés au format : ![Image](/image.png)
		var imagesWithAltMatches = line.match(/!\[.*?\]\(.*?\)/g)
		if(imagesWithAltMatches?.length){
			imagesWithAltMatches.forEach(imageMatch => {
				const image = {
					"alt": imageMatch.split("[")[1].split("]")[0],
					"src": imageMatch.split("(")[1].split(")")[0],
				}

				var imagePath = path.join(options.assetsPath, image.src)
				var imageContent
				try {
					imageContent = fs.readFileSync(imagePath)
					image.content = imageContent
					image.path = imagePath
					if(options.renameAssets) image.src = `${path.parse(imagePath).name}${path.parse(imagePath).ext}`

					contentObject.images.push(image)
					line = line.replace(
						imageMatch,
						image.src.endsWith(".mp4") ? `<video controls src="${options.publicAssetsPath.replace(/"/g, "\\\"") || ""}${image.src.replace(/"/g, "\\\"")}" aria-label="${image.alt.replace(/"/g, "\\\"")}" />`
							: `![${image.alt}](${options.publicAssetsPath || ""}${image.src})`
					)
				} catch (error) {
					contentObject.warns.push(`Attachement d'une image - Impossible de lire le fichier situé à "${imagePath}".`)
				}
			})
		}

		// modifier les <br> dans un tableau
		if(line.startsWith("|") && line.endsWith("|")){
			line = line.replaceAll("<br>", "<br/>")
		}

		// ========= Actions qui ajoutent potentiellement du contenu

		// callout sur Obsidian
		if(options.origin == "obsidian" && (line.startsWith("> [!") || line.startsWith(">[!"))){
			currentAction_set("callout")

			var tempLine = line.split("]")[1].trim()
			if(tempLine.startsWith("- ")) tempLine = tempLine.slice(2)
			line = `${line.split("]")[0]}]${tempLine}`

			var original_calloutType = (line.split("[!")[1].split("]")[0]).toLowerCase()
			var calloutTitle = line.split("]")[1]?.trim()
			var calloutType = original_calloutType != "warn" && original_calloutType != "warning" && original_calloutType != "error" ? "info" : original_calloutType

			contentObject.content += `<Callout ${calloutTitle ? `title=${JSON.stringify(calloutTitle)} ` : ""}type="${calloutType.replace("warning", "warn")}">\n`
			continue
		} else if(options.origin == "obsidian" && currentAction == "callout"){
			if(!line){
				currentAction_precedent()
				contentObject.content += "\n</Callout>\n\n"
			} else contentObject.content += `${line.startsWith(">") ? line.slice(1).trim() : line.trim()}<br/>\n`
			continue
		}

		// liens attachés au format : ![[nom du fichier]]
		// Obsidian supporte également les notes, audio, PDF etc, mais on va se concentrer sur les images
		else if(options.origin == "obsidian" && line.startsWith("![[") && line.endsWith("]]")){
			const link = line.split("[[")[1].split("]]")[0]
			if(!link.endsWith(".png") && !link.endsWith(".jpg") && !link.endsWith(".jpeg") && !link.endsWith(".gif") && !link.endsWith(".webp")){
				contentObject.warns.push(`Attachement d'une image - Le fichier situé à "${imagePath}" ne porte pas une extension d'image valide.`)
				continue
			}

			var imageContent
			var imagePath = path.join(options.assetsPath, link)
			var image = { "alt": "", "src": link, "path": imagePath }

			// Tenter de lire le fichier
			try {
				imageContent = fs.readFileSync(imagePath)
				image.content = imageContent
				if(options.renameAssets) image.src = `${path.parse(imagePath).name}${path.parse(imagePath).ext}`
			} catch (error) {
				contentObject.warns.push(`Attachement d'une image - Impossible de lire le fichier situé à "${imagePath}".`)
				continue
			}

			contentObject.content += `![](${options.publicAssetsPath || ""}${image.src})\n`
			contentObject.images.push(image)

			continue
		}

		// on masque les commentaires
		else if(line.startsWith("<!--") && line.endsWith("-->")){ // (commentaires HTML)
			if(lines[i + 1] == "") i++ // on skip la ligne d'après si c'est un saut de ligne
			continue
		} else if(line.startsWith("%%") && line.endsWith("%%")){ // (commentaires Obsidian)
			contentObject.warns.push(`Commentaire - ${line}`)
			if(lines[i + 1] == "") i++
			continue
		}

		// composents personnalisés (HTML dans un codeblock)
		else if(line.startsWith("```component")){
			currentAction_set("custom-component")
			continue
		} else if(currentAction == "custom-component" && line.startsWith("```")){
			currentAction_precedent()
			continue
		}

		// custom anchor sur les titres
		else if(options.origin == "obsidian" && line.startsWith("#")){
			const lineParts = line.trim().split(" ")
			const anchor = lineParts[lineParts.length - 1].startsWith("^") ? lineParts.pop().slice(1) : null
			contentObject.content += `${anchor ? line.replace(` ^${anchor}`, ` [#${anchor}]`) : line}\n`
		}

		// comportement par défaut
		else {
			contentObject.content += line == "" ? "\n" : `${line}\n`
		}
	}

	// Rendre le document plus propre
	contentObject.content = contentObject.content.trim()
	while(contentObject.content.startsWith("\n")) contentObject.content = contentObject.content.slice(1) // supprimer les sauts de ligne au début
	while(contentObject.content.endsWith("\n")) contentObject.content = contentObject.content.slice(0, -1) // supprimer les sauts de ligne à la fin

	// On détecte les balises HTML où on devrait importer un élément
	var imports = [
		{ search: "<Accordion", import: "import { Accordion } from 'fumadocs-ui/components/accordion';" },
		{ search: "<Accordions", import: "import { Accordions } from 'fumadocs-ui/components/accordion';" },
		{ search: "<Banner", import: "import { Banner } from 'fumadocs-ui/components/banner';" },
		{ search: "<Files", import: "import { Files } from 'fumadocs-ui/components/files';" },
		{ search: "<File", import: "import { File } from 'fumadocs-ui/components/files';" },
		{ search: "<Folder", import: "import { Folder } from 'fumadocs-ui/components/files';" },
		{ search: "<MDX", import: "import defaultMdxComponents from 'fumadocs-ui/mdx';" },
		{ search: "<ImageZoom", import: "import { ImageZoom } from 'fumadocs-ui/components/image-zoom';" },
		{ search: "<InlineTOC", import: "import { InlineTOC } from 'fumadocs-ui/components/inline-toc';" },
		{ search: "<RootToggle", import: "import { RootToggle } from 'fumadocs-ui/components/layout/root-toggle';" },
		{ search: "<Step", import: "import { Step } from 'fumadocs-ui/components/steps';" },
		{ search: "<Steps", import: "import { Steps } from 'fumadocs-ui/components/steps';" },
		{ search: "<Tab", import: "import { Tab } from 'fumadocs-ui/components/tabs';" },
		{ search: "<Tabs", import: "import { Tabs } from 'fumadocs-ui/components/tabs';" },
		{ search: "<TypeTable", import: "import { TypeTable } from 'fumadocs-ui/components/type-table';" },
	]
	imports.forEach(importItem => {
		if(contentObject.content.includes(importItem.search) && !contentObject.imports.includes(importItem.import)) contentObject.imports.push(importItem.import)
	})

	return contentObject
}