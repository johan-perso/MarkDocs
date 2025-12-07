const fs = require("fs")
const path = require("path")
const JSONC = { parse: require("comment-json").parse }
const ora = require("ora")
const convertMd = require("./convertMd")
const walkRecursive = require("./walkRecursive")

// Retirer .md ou .mdx à la fin d'un chemin
function removeMdExt(path){
	return path.endsWith(".md") ? path.slice(0, -3) : path.endsWith(".mdx") ? path.slice(0, -4) : path
}

// Obtenir tous les éventuels dossiers d'un chemin
function getPossibleFolders(path) {
	var segments = path.split("/")
	var possibleFolders = []

	for (var i = segments.length; i > 0; i--) {
		possibleFolders.push(segments.slice(0, i).join("/"))
	}

	return possibleFolders
}

module.exports = async function main(options = { enableSpinner: false, beforeLog: "" }){
	const spinner = ora({ text: "", isEnabled: options.enableSpinner, prefixText: options.beforeLog })

	const inputDir = options.inputDir
	const inputAttachmentsDir = options.inputAttachmentsDir
	const outputDir = options.outputDir
	if(!inputDir || !inputAttachmentsDir || !outputDir) throw new Error("Le dossier d'entrée, d'attachements d'entrée, ou de sortie n'a pas été spécifié.")

	const outputDirDocs = path.join(outputDir, "content", "docs")
	const attachmentsSuffix = "attached-files"
	const outputDirAttachments = path.join(outputDir, "public", attachmentsSuffix)
	const outputDirApp = path.join(outputDir, "app")

	var docsConfig
	var docsConfigFolderPath = path.join(inputDir, "_markdocs")
	var docsConfigPath = path.join(docsConfigFolderPath, "config.jsonc")
	try {
		if(!fs.existsSync(docsConfigPath)) throw new Error(`Le fichier de configuration n'existe pas, il doit être situé à ${docsConfigPath}`)
		docsConfig = fs.readFileSync(docsConfigPath, "utf-8")
		docsConfig = JSONC.parse(docsConfig)

		// Normaliser les clés de folders une seule fois pour utilisations ultérieure
		if(docsConfig?.folders) {
			const normalizedFolders = {}
			for(const [key, value] of Object.entries(docsConfig.folders)) {
				normalizedFolders[key.normalize("NFC")] = value
			}
			docsConfig.folders = normalizedFolders
		}
	} catch(e){
		spinner.fail(`Impossible de lire/décoder le fichier de configuration situé à ${docsConfigPath}`)
		console.error(e)
		process.exit(1)
	}

	var listAttachedFiles = []
	var allFolders = []
	var stats = { warn: 0, files: 0, attachments: 0 }

	// Obtenir tous les fichiers qu'on analysera
	spinner.start("Obtention des fichiers...")
	var allFiles = walkRecursive(inputDir)
	allFiles = allFiles.filter(file => file.endsWith(".md"))
	allFiles = allFiles.map(file => {
		return {
			path: file,
			parts: path.relative(inputDir, file).split("/"),
			title: path.parse(file.split("/").pop())?.name,
			content: fs.readFileSync(file, "utf-8")
		}
	})
	spinner.succeed(`${allFiles.length} fichiers trouvés.`)

	// Analyser chaque fichier
	console.log(options.beforeLog)
	allFiles = await Promise.all(allFiles.map(async file => {
		spinner.start(`Analyse du fichier situé à "${file.parts.join("/")}"...`)
		const convertedObject = await convertMd.convertMarkdown(
			file.content,
			{
				origin: "obsidian",
				assetsPath: inputAttachmentsDir, // dossier qui contient toutes les images attachés
				renameAssets: true, // donner un nom aléatoire aux images attachés, garde l'extension original
				publicAssetsPath: `/${attachmentsSuffix}/` // chemin qui permet d'accéder aux images attachés depuis la docs
			}
		)
		spinner.succeed(`Analyse du fichier situé à "${file.parts.join("/")}".`)

		file.metadata = convertedObject.metadata
		file.content = convertedObject.content
		file.imports = convertedObject.imports
		file.warns = convertedObject.warns

		convertedObject.images.forEach(image => {
			if(listAttachedFiles.find(attachedFile => attachedFile.src == image.src)) return
			listAttachedFiles.push(image)
		})

		return file
	}))

	// Créer les fichier de sortie
	console.log(options.beforeLog)
	if(fs.existsSync(outputDirDocs)) fs.rmSync(outputDirDocs, { recursive: true })
	fs.mkdirSync(outputDirDocs, { recursive: true })
	await Promise.all(allFiles.map(async file => {
		spinner.start(`Création du fichier de sortie pour "${file.parts.join("/")}"...`)

		// Vérifier dans la config si on doit remplacer le nom de certains (sous) dossiers
		file.lastFolderOriginalName = file.parts[file.parts.length - 2]
		file._parts = JSON.parse(JSON.stringify(file.parts))

		var possibleFolders = getPossibleFolders(file.parts.join("/").normalize("NFC"))
		for(var i = 0; i < possibleFolders.length; i++){
			var folderName = possibleFolders[i]
			if(docsConfig?.folders?.[folderName]){
				var tempParts = file.parts.join("/").normalize("NFC")
				tempParts = tempParts.replace(folderName, docsConfig.folders[folderName].slug)
				file.parts = tempParts.split("/")
			}
		}

		file.metadata = file.metadata || {}

		if(file?.metadata?.name) file.parts[file.parts.length - 1] = `${file.metadata.name}.md`
		else {
			spinner.warn(`Le fichier "${file._parts.join("/")}" n'a pas de nom dans ses propriétés. Le nom du fichier sera utilisé.`)
			stats.warn++
		}

		delete file.metadata.name
		file.metadata.title = file.title

		// Déterminer le contenu du document, et son chemin
		var outputContent = !file.content ? null : `---\n${Object.keys(file.metadata).map(key => `${key}: ${file.metadata[key]}`).join("\n")}\n---\n\n${file.imports.length ? `${file.imports.join("\n")}\n\n` : ""}${file.content}`
		if(file.parts.length > 1){
			var currentPath = outputDirDocs
			for(var i = 0; i < file.parts.length - 1; i++){ // créer les sous-dossiers s'ils n'existent pas
				currentPath = path.join(currentPath, file.parts[i])
				if(!fs.existsSync(currentPath)) fs.mkdirSync(currentPath, { recursive: true })
			}

			var folderObject = { path: currentPath, originalPath: path.join(file.path, ".."), title: file.lastFolderOriginalName }
			if(!allFolders.find(folder => folder.path == folderObject.path)) allFolders.push(folderObject)
		}

		// Afficher si on a des avertissements
		if(file.warns.length){
			spinner.warn(`Le fichier "${file._parts.join("/")}" a ${file.warns.length} avertissements :\n${options.beforeLog}  - ${file.warns.join(`\n${options.beforeLog}  - `)}.`)
			stats.warn += file.warns.length
		}

		// Enregistrer le document
		if(outputContent){
			var filenameWithMdxExt = `${file.parts[file.parts.length - 1].endsWith(".md") ? file.parts[file.parts.length - 1].slice(0, -3) : file.parts[file.parts.length - 1]}.mdx`
			file.parts[file.parts.length - 1] = filenameWithMdxExt
			fs.writeFileSync(path.join(outputDirDocs, file.parts.join("/")), outputContent)
			spinner.succeed(`Le fichier "${file.parts.join("/")}" a été créé.`)
			stats.files++
		} else {
			spinner.warn(`Le fichier "${file.parts.join("/")}" n'a pas de contenu.`)
			stats.warn++
		}
	}))

	// Copier les images attachés
	console.log(options.beforeLog)
	spinner.start("Copie des images attachées...")
	if(fs.existsSync(outputDirAttachments)) fs.rmSync(outputDirAttachments, { recursive: true })
	fs.mkdirSync(outputDirAttachments, { recursive: true })
	await Promise.all(listAttachedFiles.map(async attachedFile => {
		// Si on a plusieurs images avec le même attachedFile.src mais pas le même attachedFile.path
		if(listAttachedFiles.filter(file => file.src == attachedFile.src).find(file => file.path != attachedFile.path)){
			spinner.warn(`Plusieurs images attachées ont le même nom "${attachedFile.src}", mais ne sont pas situées dans le même dossier.`)
			stats.warn++
		} else stats.attachments++

		fs.writeFileSync(path.join(outputDirAttachments, attachedFile.src), attachedFile.content)
	}))
	spinner.succeed("Copie des images attachées.")

	// Créer du fichier de méta-données
	spinner.start("Création du fichier de méta-données principal...")
	fs.writeFileSync(path.join(outputDirDocs, "meta.json"), JSON.stringify({
		pages: docsConfig?.pages.map(pageInConfig => {
			if(!pageInConfig.startsWith("---")){
				// Sauvegarder pageInConfig original avant transformation
				var originalPageInConfig = pageInConfig.normalize("NFC")
				var possibleFolders = getPossibleFolders(pageInConfig.normalize("NFC"))

				// Vérifier dans la config si on doit remplacer le nom de certains (sous) dossiers
				for(var i = 0; i < possibleFolders.length; i++){
					var folderName = possibleFolders[i]
					if(docsConfig?.folders?.[folderName]) pageInConfig = pageInConfig.replace(folderName, docsConfig.folders[folderName].slug)
				}

				var pageInAllFiles = allFiles.find(file => file._parts.join("/").normalize("NFC") == originalPageInConfig)
				return removeMdExt(!pageInAllFiles ? pageInConfig : pageInAllFiles.parts.join("/"))
			}

			return pageInConfig
		})
	}, null, 2))
	spinner.succeed("Création du fichier de méta-données principal.")

	// On créé un fichier de méta-données dans les sous dossiers
	spinner.start("Création des fichiers de méta-données de dossier...")
	allFolders = allFolders.filter((folder, index, self) => index === self.findIndex(t => t.path === folder.path))
	await Promise.all(allFolders.map(async folderDetails => {
		folderDetails.relativeOriginalPath = path.join(path.relative(inputDir, folderDetails.originalPath))
		folderDetails.relativeOriginalPath = folderDetails.relativeOriginalPath.split(path.sep).filter(part => part !== "..").join(path.sep).normalize("NFC")

		var folderMetaFromConfig = docsConfig?.folders?.[folderDetails.relativeOriginalPath]
		if(folderMetaFromConfig) folderMetaFromConfig.pages = (folderMetaFromConfig?.pages || []).map(pageInConfig => {
			// Obtenir le slug du fichier
			var pageInAllFiles = allFiles.find(file => file.path.normalize("NFC").endsWith(path.join(folderDetails.relativeOriginalPath, pageInConfig.normalize("NFC"))))
			var fileSlug = pageInAllFiles ? pageInAllFiles.parts.join("/") : null
			if(fileSlug) return removeMdExt(path.basename(fileSlug))

			// Si c'est un dossier, on obtient le sien
			var folderSlug = allFolders.find(folder => folder.originalPath.normalize("NFC").endsWith(path.join(folderDetails.relativeOriginalPath, pageInConfig.normalize("NFC"))))
			if(folderSlug) return folderSlug.path.split(path.sep).pop()
		})

		fs.writeFileSync(path.join(folderDetails.path, "meta.json"), JSON.stringify({
			title: folderDetails.title,
			pages: folderMetaFromConfig?.pages?.length ? folderMetaFromConfig.pages : ["..."]
		}, null, 2))
	}))
	spinner.succeed("Création des fichiers de méta-données de dossier.")

	// Copier le favicon dans le projet
	console.log(options.beforeLog)
	spinner.start("Finalisation...")
	var faviconPath // déterminer si on a un favicon à copier
	if(fs.existsSync(path.join(docsConfigFolderPath, "favicon.png"))) faviconPath = path.join(docsConfigFolderPath, "favicon.png")
	else if(fs.existsSync(path.join(docsConfigFolderPath, "icon.png"))) faviconPath = path.join(docsConfigFolderPath, "icon.png")
	if(faviconPath) fs.copyFileSync(faviconPath, path.join(outputDirApp, "icon.png")) // on le copie si on l'a trouvé
	else { // on le supprime si on en a plus mais qu'on en avait un avant
		if(fs.existsSync(path.join(outputDirApp, "icon.png"))) fs.rmSync(path.join(outputDirApp, "icon.png"))
	}

	// Modifier des éléments dans les fichiers
	var semimanualsEdits = [
		{
			path: path.join(outputDirApp, "layout.config.jsx"),
			find: "const PROJECT_NAME = ",
			replace: `const PROJECT_NAME = '${docsConfig?.sidebarName?.replace(/'/g, "\\'") || "Documentation"}'`
		},
		{
			path: path.join(outputDirApp, "layout.config.jsx"),
			find: "const GITHUB_LINK = ",
			replace: `const GITHUB_LINK = '${docsConfig?.githubLink?.replace(/'/g, "\\'")}'`
		},
		{
			path: path.join(outputDirApp, "layout.config.jsx"),
			find: "const TWITTER_LINK = ",
			replace: `const TWITTER_LINK = '${docsConfig?.twitterLink?.replace(/'/g, "\\'")}'`
		},
		{
			path: path.join(outputDirApp, "layout.config.jsx"),
			find: "const CONTACT_LINK = ",
			replace: `const CONTACT_LINK = '${docsConfig?.contactLink?.replace(/'/g, "\\'")}'`
		},
		{
			path: path.join(outputDirApp, "(home)", "[[...slug]]", "page.tsx"),
			find: "const PROJECT_NAME = ",
			replace: `const PROJECT_NAME = '${docsConfig?.name?.replace(/'/g, "\\'") || "Documentation"}'`
		},
	]
	semimanualsEdits.forEach(edit => {
		try {
			if(!fs.existsSync(edit.path)) throw new Error(`Impossible de localiser le fichier situé à ${edit.path}. Vous devrez faire un rebuild de zéro.`)
			var fileContent = fs.readFileSync(edit.path, "utf-8")
			var fileContentLines = fileContent.split("\n")
			var lineIndex = fileContentLines.findIndex(line => line.includes(edit.find))
			if(lineIndex == -1) throw new Error(`Impossible de localiser la ligne contenant "${edit.find}" dans le fichier situé à ${edit.path}. Vous devrez faire un rebuild de zéro.`)
			fileContentLines[lineIndex] = edit.replace
			fs.writeFileSync(edit.path, fileContentLines.join("\n"))
		} catch(e){
			spinner.warn(`Impossible de modifier le fichier situé à ${edit.path}. Vous devrez faire un rebuild de zéro.`)
			console.error(options.beforeLog, e)
			stats.warn++
		}
	})
	spinner.succeed("Finalisation.")

	console.log(`${options.beforeLog}\n${JSON.stringify({
		success: true,
		stats
	})}         <--- JSON RESULT`)

	return {
		success: true,
		stats
	}
}
