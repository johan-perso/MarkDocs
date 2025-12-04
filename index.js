#!/usr/bin/env node

const { intro, outro, text, isCancel, cancel, group, spinner, confirm, tasks, log } = require("@clack/prompts")
const fs = require("fs")
const path = require("path")
const { tmpdir } = require("os")
const JSONC = { parse: require("comment-json").parse }
const commandExistsSync = require("command-exists").sync
const picocolors = require("picocolors")
const { execCommand, spawnCommand } = require("./utils/childProcess")
const checkIsUrl = require("./utils/checkIsUrl")
const updateDocs = require("./utils/updateDocs")
const walkRecursive = require("./utils/walkRecursive")

var command = process.argv[2]
var _args = process.argv.slice(2)
if(_args[0] == command) _args = _args.slice(1)

var args = {}
_args.forEach(arg => {
	if(arg.startsWith("-")){
		var argName = arg.split("=")[0].slice(arg.startsWith("--") ? 2 : 1)
		var argValue = arg.split("=")[1]
		if(argValue === undefined) argValue = true
		args[argName] = argValue
	}
})

function firstLetterUpper(string){
	return string.charAt(0).toUpperCase() + string.slice(1)
}
function cleanPath(value){
	if((value.startsWith("'") && value.startsWith("'")) || (value.startsWith("\"") && value.startsWith("\""))) return value.slice(1, -1)
	return path.resolve(value)
}
function formulateDocsTempPath(docsFolder, docsName){
	return path.join(tmpdir(), `markdocs-temp-${path.basename(docsFolder).toLowerCase().replace(/[^a-z0-9]/g, "_")}-${docsName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`)
}
function cancelAndQuit(msg){
	cancel(msg)
	process.exit(0)
}
async function isGitRepoClean(repoPath){
	var gitStatus
	try {
		gitStatus = await execCommand("git status --porcelain", { cwd: repoPath })
	} catch (error) {
		if(error.message.toLowerCase().includes("not a git repository")) gitStatus = ""
		else throw new Error(`Impossible de vérifier l'état du dépôt Git : ${error}`)
	}

	if(gitStatus?.trim() === "") return true
	else return false
}
function showNotif(title, msg){
	if(process.env.TERM_PROGRAM == "ghostty") process.stdout.write(`\x1b]777;notify;${title};${msg}\x07`)
}

async function copyFolder(src, dest){
	if(fs.existsSync(dest)) fs.rmSync(dest, { recursive: true })
	fs.mkdirSync(dest, { recursive: true })

	var files = fs.readdirSync(src)

	for(var file of files){
		var srcPath = path.join(src, file)
		var destPath = path.join(dest, file)

		if(fs.lstatSync(srcPath).isDirectory()) await copyFolder(srcPath, destPath)
		else fs.copyFileSync(srcPath, destPath)
	}

	return true
}

async function askDocsPath(){
	var docsFolder = await text({
		message: "Chemin de la documentation",
		validate(value) {
			if(value === "") return "Le chemin ne peut pas être vide"
			value = cleanPath(value)
			if(!fs.existsSync(path.resolve(value))) return "Aucun dossier n'est trouvé à cet emplacement"
			if(!fs.lstatSync(path.resolve(value)).isDirectory()) return "Ce chemin doit pointer vers un dossier"
		}
	})
	if(isCancel(docsFolder)) return cancelAndQuit("Opération annulé.")
	docsFolder = cleanPath(docsFolder)

	return docsFolder
}

async function readConfiguration(configPath, logger = console){ // le logger peut être la fonction log de clack/prompts, ou la console
	var docsConfig
	try {
		if(!fs.existsSync(configPath)) logger.error(`Le fichier de configuration n'existe pas, il doit être situé à l'emplacement suivant :\n${configPath}`) && process.exit(1)
		docsConfig = fs.readFileSync(configPath, "utf-8")
		docsConfig = JSONC.parse(docsConfig)
	} catch(e){
		logger.error(`La configuration n'a pas pu être lue correctement, le fichier est situé à l'emplacement suivant :\n${configPath}\n${e?.message || e?.stack || e}.`)
		process.exit(1)
	}
	return docsConfig
}

async function resetMarkdocsProject(docsFolder){
	var shouldReset = await confirm({
		message: "Un projet MarkDocs existe déjà dans ce dossier. Vos documents ne seront pas modifiés, mais les configurations seront effacées. Voulez-vous continuer ?",
		initialValue: false,
	})
	if(isCancel(shouldReset) || !shouldReset) return cancelAndQuit("Opération annulé.")

	try { fs.rmSync(path.resolve(docsFolder, "_markdocs"), { recursive: true }) } catch (error) {
		log.error(`Impossible de supprimer le dossier existant. ${error?.message || error}`)
		throw new Error("Impossible de supprimer le dossier existant.")
	}

	return true
}

async function initialSetup(){
	intro("MarkDocs - Création d'un projet")

	var docsFolder = await askDocsPath()

	if(!fs.existsSync(path.resolve(docsFolder))) return log.error("Le dossier situé à l'emplacement spécifié n'existe pas.")
	var docsFolderContent
	try {
		docsFolderContent = fs.readdirSync(docsFolder)
		if(docsFolderContent.includes("_markdocs")) await resetMarkdocsProject(docsFolder)
	} catch (error) {
		log.error(`Impossible de lire le contenu du dossier spécifié. ${error?.message || error}`)
		throw new Error("Impossible de lire le contenu du dossier spécifié.")
	}

	var attachmentsFolder = await text({
		message: "Chemin contenant toutes les images attachées aux projets",
		validate(value) {
			if(value === "") return "Le chemin ne peut pas être vide"
			value = cleanPath(value)
			if(!fs.existsSync(path.resolve(value))) return "Aucun dossier n'est trouvé à cet emplacement"
			if(!fs.lstatSync(path.resolve(value)).isDirectory()) return "Ce chemin doit pointer vers un dossier"
		}
	})
	if(isCancel(attachmentsFolder)) return cancelAndQuit("Opération annulé.")
	attachmentsFolder = cleanPath(attachmentsFolder)

	if(!fs.existsSync(path.resolve(docsFolder))) return log.error("Le dossier situé à l'emplacement spécifié n'existe pas.")
	var docsFolderContent
	try {
		docsFolderContent = fs.readdirSync(docsFolder)
		if(docsFolderContent.includes("_markdocs")) await resetMarkdocsProject(docsFolder)
	} catch (error) {
		log.error(`Impossible de lire le contenu du dossier spécifié. ${error?.message || error}`)
		throw new Error("Impossible de lire le contenu du dossier spécifié.")
	}

	const { name, sidebarName } = await group(
		{
			name: () => text({ message: "Nom du projet", initialValue: `${firstLetterUpper(path.basename(docsFolder))} Docs` }),
			sidebarName: () => text({ message: "Nom affiché dans la barre de navigation", initialValue: `${firstLetterUpper(path.basename(docsFolder))} – Docs` }),
		},
		{
			onCancel: () => {
				cancelAndQuit("Opération annulé.")
			},
		}
	)

	var { githubLink, twitterLink, contactLink } = await group(
		{
			githubLink: () => text({ message: "URL du dépôt GitHub (facultatif)", initialValue: "https://github.com/", validate: value => checkIsUrl(value, true) }),
			twitterLink: () => text({ message: "URL du profil Twitter (facultatif)", initialValue: "https://x.com/", validate: value => checkIsUrl(value, true) }),
			contactLink: () => text({ message: "URL de contact (facultatif)", validate: value => checkIsUrl(value, true) }),
		},
		{
			onCancel: () => {
				cancelAndQuit("Opération annulé.")
			},
		}
	)

	githubLink = githubLink === undefined || githubLink == "https://github.com/" ? "" : githubLink
	twitterLink = twitterLink === undefined || twitterLink == "https://x.com/" ? "" : twitterLink
	contactLink = contactLink === undefined || contactLink == "" ? "" : contactLink

	log.info(`MarkDocs va initialiser un projet dans le dossier suivant :\n${docsFolder}`)
	const s = spinner()
	s.start("Un dossier \"_markdocs\" sera créé à cet emplacement.")
	await new Promise(resolve => setTimeout(resolve, 3000))
	s.stop("Un dossier \"_markdocs\" a été créé à cet emplacement.")

	fs.mkdirSync(path.resolve(docsFolder, "_markdocs"), { recursive: true })
	try { fs.copyFileSync(path.resolve(__dirname, "README.md"), path.resolve(docsFolder, "_markdocs", "README.md")) } catch (e) { }
	fs.writeFileSync(path.resolve(docsFolder, "_markdocs", "config.jsonc"), `{
	"attachmentsDir": ${JSON.stringify(path.relative(docsFolder, attachmentsFolder))}, // Dossier contenant les fichiers attachés aux documents (images par exemple), relatif à la racine du projet ou absolu

	"name": ${JSON.stringify(name)}, // Nom de la documentation, affiché dans le titre de la page
	"sidebarName": ${JSON.stringify(sidebarName)}, // Nom de la documentation, affiché dans la barre de navigation
	"githubLink": ${JSON.stringify(githubLink)}, // Affiché tout en haut de la barre de navigation, laisser vide pour ne pas afficher
	"twitterLink": ${JSON.stringify(twitterLink)},
	"contactLink": ${JSON.stringify(contactLink)},

	"pages": [ // Sidebar principale, en savoir plus --> https://fumadocs.dev/docs/ui/page-conventions#pages
		"Introduction.md",
		"---Nom d'une catégorie---",
		"Exemple/1.md",
		"Exemple/2.md",
		"Exemple/Sous-Dossier"
	],

	"folders": { // Gestion des dossiers
		"Exemple": { // <-- nom du dossier (local)
			"slug": "example" // <-- chemin du dossier dans l'URL
		},
		"Exemple/Sous-Dossier": { // <-- nom du dossier (local)
			"slug": "example/subfolder", // <-- chemin du dossier dans l'URL
			"pages": [ // Pages contenues dans le dossier, l'ordre sera respecté
				"Sous-Page.md"
			]
		}
	}
}`)

	fs.writeFileSync(path.resolve(docsFolder, ".gitignore"), ".vercel\n.env\n.vscode\n.idea\n.cache\n**/.DS_Store\n.DS_Store?\nThumbs.db\ndesktop.ini")

	if(!docsFolderContent.includes(".git")){
		const initGitRepo = await confirm({
			message: "Initialiser un dépôt Git vide dans ce projet ?",
			initialValue: true,
		})
		if(isCancel(initGitRepo)) return cancelAndQuit("Le projet a été créé mais ne sera pas construit.")
		if(initGitRepo) await execCommand("git init", { cwd: docsFolder })
	}

	log.warn(`Vous devriez modifier le fichier de configuration de votre documentation MarkDocs afin de modifier l'affichage\ndes pages et des dossiers dans la sidebar. Les propriétés "pages" et "folders" gèrent ces réglages.\nConfiguration : ${path.join(docsFolder, "_markdocs", "config.jsonc")}`)

	const shouldContinue = await confirm({
		message: "Construire le projet pour la première fois ?",
		initialValue: true,
	})
	if(isCancel(shouldContinue)) return cancelAndQuit("Le projet a été créé mais ne sera pas construit.")

	showNotif("MarkDocs CLI", "Le projet a été créé avec succès")

	if(shouldContinue){
		outro("Le projet a été créé avec succès à l'emplacement spécifié.")
		console.log("")
		args.force = true // construire en ignorant l'état du dépôt git
		await buildProject(docsFolder)
	} else outro("Le projet a été créé avec succès à l'emplacement spécifié.")
}

async function createVercelProject(docsFolder){
	intro("MarkDocs - Création d'un projet sur Vercel")

	if(!docsFolder) docsFolder = await askDocsPath()
	var docsConfigPath = path.join(docsFolder, "_markdocs", "config.jsonc")
	if(!fs.existsSync(path.join(docsFolder))) return log.error("Le dossier spécifié n'existe pas.")
	if(!fs.existsSync(path.join(docsFolder, "_markdocs", "config.jsonc"))) return log.error("Le dossier spécifié ne pointe pas vers une documentation MarkDocs, ou celle ci n'a pas été initialisé correctement.\nLe fichier de configuration est manquant, vous devrez réinitialiser un projet ici.")

	if(fs.existsSync(path.join(docsFolder, ".vercel"))){
		log.error(`Un dossier .vercel a été trouvé dans le dossier spécifié, ce qui signifie que votre documentation (en local) est déjà relié à un projet Vercel.\nVous pouvez supprimer le dossier .vercel pour défaire le lien, il se situe à l'emplacement suivant :\n${path.join(docsFolder, ".vercel")}`)
		process.exit(1)
	}

	var docsConfig = await readConfiguration(docsConfigPath, log)
	if(!docsConfig.name) return log.error("Le fichier de configuration est incorrect, la propriété \"name\" est manquante dans celui-ci.")

	var docsTempFolderPath = formulateDocsTempPath(docsFolder, docsConfig.name)
	if(!fs.existsSync(docsTempFolderPath)){
		log.error("Pour relier une documentation à Vercel, vous devez avoir construit le projet au moins une fois.\nExécuter un nouveau build puis réessayer, il sera alors transféré automatiquement.")
		process.exit(1)
	}

	if(!commandExistsSync("vercel")){
		log.error("Vercel CLI n'est pas installé. Veuillez l'installer puis réessayer.")
		log.info("https://vercel.com/docs/cli#installing-vercel-cli")
		process.exit(1)
	}

	var vercelProjectName = args["vercel-project-name"]
	if(!vercelProjectName){
		vercelProjectName = await text({
			message: "Nom du projet sur Vercel",
			placeholder: "markdocs-project",
			validate(value) {
				if(value === "") return "Le nom ne peut pas être vide"
				if(value.length > 100) return "Le nom du projet doit faire moins de 100 caractères"
				if(value != value.toLowerCase()) return "Les lettres dans le nom du projet doivent être en minuscules"
				if(value.includes(" ") || value.includes("---")) return "Le nom du projet doit être composé de lettres, de chiffres, et des caractères suivants autorisés : . _ -"
			}
		})
		if(isCancel(vercelProjectName)) return cancelAndQuit("Opération annulé.")
	}
	if(vercelProjectName.includes(" ")) vercelProjectName = vercelProjectName.replaceAll(" ", "-")
	if(vercelProjectName.includes("---")) vercelProjectName = vercelProjectName.replaceAll("---", " ")
	vercelProjectName = vercelProjectName.trim().toLowerCase()
	if(vercelProjectName.length > 100) vercelProjectName = vercelProjectName.slice(0, 100)

	fs.writeFileSync(path.join(docsTempFolderPath, "vercel.json"), JSON.stringify({ framework: "nextjs" })) // on indique que c'est un projet NextJS
	if(fs.existsSync(path.join(docsTempFolderPath, ".vercel"))) fs.rmSync(path.join(docsTempFolderPath, ".vercel"), { recursive: true }) // si on a déjà un projet lié, on le supprime

	console.log("\n●  Connecté en tant que :\n")
	try { await spawnCommand("vercel", ["whoami", "--no-color"], { cwd: docsTempFolderPath }) } catch (error) { process.exit(1) }
	console.log("\n\n●  Création du projet :")
	console.log("   Dans le cas où vous rencontrez le message d'erreur \"Failed to detect project settings\",\n   vous pouvez constater l'avancement du déploiement depuis votre panel Vercel.\n   Il devrait s'agir d'un faux positif.\n")
	try { await spawnCommand("vercel", ["link", "--project", vercelProjectName, "--yes", "--no-color"], { cwd: docsTempFolderPath }) } catch (error) { } // lui on fait surtt pas un process.exit

	try {
		fs.mkdirSync(path.join(docsFolder, ".vercel"), { recursive: true })
		fs.copyFileSync(path.join(docsTempFolderPath, ".vercel", "project.json"), path.join(docsFolder, ".vercel", "project.json")) // on copie le fichier généré par Vercel dans le dossier de la documentation
		fs.rmSync(path.join(docsTempFolderPath, "vercel.json"))

		if(fs.existsSync(path.join(docsTempFolderPath, ".vercel", "project.json"))) outro("Le projet a été créé avec succès et a été enregistré dans votre documentation.")
	} catch (error) {
		log.error(`Impossible de copier le fichier généré par Vercel dans le dossier de la documentation.\n${error?.message || error?.stack || error}`)
		process.exit(1)
	}
}

async function buildProject(docsFolder){
	intro("MarkDocs - Construction du projet")

	if(!docsFolder) docsFolder = await askDocsPath()

	var docsConfigPath = path.join(docsFolder, "_markdocs", "config.jsonc")
	if(!fs.existsSync(path.join(docsFolder))) return log.error("Le dossier de la documentation n'existe pas.")
	if(!fs.existsSync(docsConfigPath)) return log.error("Le dossier ne pointe pas vers une documentation MarkDocs, ou celle ci n'a pas été initialisé correctement.\nLe fichier de configuration est manquant, vous devrez réinitialiser ce projet.")
	var docsConfig = await readConfiguration(docsConfigPath, log)
	if(!docsConfig.name || !docsConfig.sidebarName) return log.error("Le fichier de configuration est incorrect, les propriétés \"name\" et \"sidebarName\" sont manquantes.")

	if(!docsConfig.attachmentsDir) return log.error("Le fichier de configuration est incorrect, la propriété \"attachmentsDir\" est manquante.")
	if(!fs.existsSync(path.join(docsFolder, docsConfig.attachmentsDir))) return log.error(`Le dossier qui doit contenir les attachements n'est pas trouvé. Vous pouvez le redéfinir depuis la configuration de ce projet.\nIl doit être situé à l'emplacement suivant : ${path.join(docsFolder, docsConfig.attachmentsDir)}`)

	var docsTempFolder = { path: formulateDocsTempPath(docsFolder, docsConfig.name), exists: false, allFiles: [], count: 0 }
	try { // on vérifie si on a pas déjà un dossier existant
		if(!fs.existsSync(docsTempFolder.path)){ // s'il existe pas, on le créé
			fs.mkdirSync(docsTempFolder.path, { recursive: true })
		} else if(args.reinit) { // s'il existe, mais qu'on doit le réinitialiser
			fs.rmSync(docsTempFolder.path, { recursive: true })
			fs.mkdirSync(docsTempFolder.path, { recursive: true })
		} else { // s'il existe et qu'on ne doit pas le réinitialiser
			// Obtenir les détails sur le dossier
			docsTempFolder.exists = true
			docsTempFolder.allFiles = fs.readdirSync(docsTempFolder.path)
			docsTempFolder.count = docsTempFolder.allFiles.length

			// Vérifier qu'il est utilisable et propre
			// Le dossier doit être vide, ou contenir à la fois le package.json et le next.config.js
			if(docsTempFolder.count != 0 && docsTempFolder.count != 1 && !(docsTempFolder.allFiles.includes("package.json") && docsTempFolder.allFiles.includes(".creation_timestamp") && (docsTempFolder.allFiles.includes("next.config.js") || docsTempFolder.allFiles.includes("next.config.mjs")))){
				log.warn("Le dossier temporaire existe déjà, mais semble être inutilisable. Les fichiers existants seront nettoyés.")
				await new Promise(resolve => setTimeout(resolve, 2000))
				fs.rmSync(docsTempFolder.path, { recursive: true })
				fs.mkdirSync(docsTempFolder.path, { recursive: true })

				docsTempFolder.exists = false
				docsTempFolder.allFiles = []
				docsTempFolder.count = 0
			}
		}
	} catch (err) {
		log.error(`Impossible de vérifier et créer le dossier temporaire. ${err?.message || err}`)
		throw new Error("Impossible de vérifier et créer le dossier temporaire.")
	}

	// Si on a pas tout commit dans le dossier d'entrée, on affiche un message d'erreur et on demande de tout commit avant de continuer
	if(!args.force && !(await isGitRepoClean(docsFolder))){
		log.error("Le dépôt Git de votre documentation n'est pas propre. Utiliser l'argument --force ou assurez-vous d'avoir commit vos changements.")
		return cancel("Opération annulé.")
	}

	// Si le dossier temporaire existe, mais a été créé il y a plus de 2 semaines, on le supprime
	if(docsTempFolder.exists && docsTempFolder.allFiles.includes(".creation_timestamp")){
		var creationTimestamp = fs.readFileSync(path.join(docsTempFolder.path, ".creation_timestamp"), "utf8")
		if(Date.now() - creationTimestamp > 2 * 7 * 24 * 60 * 60 * 1000){
			log.warn("Le dossier temporaire existe depuis plus de 2 semaines. Les fichiers existants seront nettoyés.")
			await new Promise(resolve => setTimeout(resolve, 2000))
			fs.rmSync(docsTempFolder.path, { recursive: true })
			fs.mkdirSync(docsTempFolder.path, { recursive: true })

			docsTempFolder.exists = false
			docsTempFolder.allFiles = []
			docsTempFolder.count = 0
		}
	}

	log.info(`MarkDocs va construire le projet situé à :\n${docsFolder}\n\nUn dossier temporaire sera utilisé depuis l'emplacement :\n${docsTempFolder.path}`)

	var packageManager = "npm"
	if(commandExistsSync("bun")) packageManager = "bun"
	else if(commandExistsSync("pnpm")) packageManager = "pnpm"

	var docsFolderContent
	var deploymentMethod = "manual"

	await tasks([
		!docsTempFolder.allFiles.includes("next.config.js") && !docsTempFolder.allFiles.includes("next.config.mjs") ? {
			title: "Téléchargement du projet Fumadocs par défaut",
			task: async (message) => {
				try { // dans le doute, ptet y'a un .ds_store par exemple qui pourrait empêcher le git clone
					fs.rmSync(docsTempFolder.path, { recursive: true })
					fs.mkdirSync(docsTempFolder.path, { recursive: true })
				} catch (error) { }

				try { await execCommand(`git clone --depth 1 --branch main https://github.com/johan-perso/markdocs-template ${docsTempFolder.path}`, { cwd: docsTempFolder.path }) } catch (error) {
					log.error(`Le projet Fumadocs n'a pas pu être téléchargé. ${error?.message || error}`)
					throw new Error("Le projet Fumadocs n'a pas pu être téléchargé.")
				}

				try { fs.rmSync(path.join(docsTempFolder.path, ".git"), { recursive: true }) } catch (error) {
					log.error(`Impossible de finaliser le téléchargement. Le dossier .git n'a pas pu être supprimé. ${error?.message || error}`)
					throw new Error("Impossible de finaliser le téléchargement. Le dossier .git n'a pas pu être supprimé.")
				}

				try { fs.writeFileSync(path.join(docsTempFolder.path, ".creation_timestamp"), new Date().toISOString()) } catch (error) { } // indiquer la date de création du dossier temporaire
			},
		} : null,
		{
			title: "Conversion des documents Markdown en pages",
			task: async (message) => {
				await new Promise(resolve => setTimeout(resolve, 2000))
				var beforeLog = picocolors.dim("│  ")

				var result = await updateDocs({
					enableSpinner: true, // Définir sur false pr mieux afficher dans un child process
					inputDir: docsFolder,
					inputAttachmentsDir: path.join(docsFolder, docsConfig.attachmentsDir),
					outputDir: docsTempFolder.path,
					beforeLog,
				})

				if(!result.success){
					log.error(`La conversion des documents Markdown a échoué: ${result}`)
					throw new Error(`La conversion des documents Markdown a échoué: ${result}`)
				}
				else return `Conversion effectuée pour ${result.stats.files} document${result.stats.files > 1 ? "s" : ""} et ${result.stats.attachments} attachement${result.stats.attachments > 1 ? "s" : ""}${result.stats.warn > 1 ? picocolors.red(`, avec ${result.stats.warn} avertissement${result.stats.warn > 1 ? "s" : ""}`) : ""}.`
			},
		},
		!docsTempFolder.allFiles.includes("node_modules") ? {
			title: `Téléchargement des dépendances (avec ${packageManager})`,
			task: async (message) => {
				try { await execCommand(`${packageManager} install`, { cwd: docsTempFolder.path }) } catch (error) {
					log.error(`Impossible de télécharger les node_modules. ${error?.message || error}`)
					throw new Error("Impossible de télécharger les node_modules.")
				}
			},
		} : null,
		{
			title: "Construction",
			task: async (message) => {
				try {
					docsFolderContent = fs.readdirSync(docsFolder)
					if(docsFolderContent.includes(".vercel")) await copyFolder(path.join(docsFolder, ".vercel"), path.join(docsTempFolder.path, ".vercel"))
					if(docsFolderContent.includes(".gitignore")) fs.copyFileSync(path.join(docsFolder, ".gitignore"), path.join(docsTempFolder.path, ".gitignore"))
				} catch (error) {
					log.error(`Impossible de copier certains fichiers de la documentation dans le dossier temporaire. ${error?.message || error}`)
					throw new Error("Impossible de copier certains fichiers de la documentation dans le dossier temporaire.")
				}

				try { // on copie les documents sources si on a besoin de les restaurer, ça peut être utile imo
					var filesToCopy = await walkRecursive(docsFolder, true, true)
					for(var i = 0; i < filesToCopy.length; i++){
						var file = filesToCopy[i]
						var relativePath = path.relative(docsFolder, file)
						var outputPath = path.join(docsTempFolder.path, ".markdocs_source", relativePath)

						if(fs.lstatSync(file).isFile()) {
							if(!fs.existsSync(path.dirname(outputPath))) {
								fs.mkdirSync(path.dirname(outputPath), { recursive: true })
							}
							fs.copyFileSync(file, outputPath)
						} else {
							await copyFolder(file, outputPath)
						}
					}
				} catch (error) {
					console.log("flop", error)
				}

				try { await execCommand(`${packageManager} run build`, { cwd: docsTempFolder.path }) } catch (error) {
					log.error(`Impossible de compiler le projet avec "${packageManager} run build". ${error?.message || error}`)
					throw new Error(`Impossible de compiler le projet avec "${packageManager} run build".`)
				}

				docsTempFolder.allFiles = fs.readdirSync(docsTempFolder.path)
				docsTempFolder.count = docsTempFolder.allFiles.length

				if(!docsTempFolder.allFiles.includes(".next")){
					log.error("La construction du projet a échoué. Le dossier \".next\" n'a pas été trouvé après le build.")
					throw new Error("La construction du projet a échoué. Le dossier \".next\" n'a pas été trouvé après le build.")
				}
			},
		},
		{
			title: "Déploiement",
			task: async (message) => {
				if(docsFolderContent.includes(".vercel")) deploymentMethod = "vercel"

				if(deploymentMethod == "vercel"){
					message("Déploiement sur Vercel...")
					await new Promise(resolve => setTimeout(resolve, 3000))

					if(!commandExistsSync("vercel")){
						log.error("Le CLI Vercel doit être installé et prêt à l'emploi. Lisez la documentation de MarkDocs pour plus d'informations.")
						throw new Error("Le CLI Vercel doit être installé et prêt à l'emploi. Lisez la documentation de MarkDocs pour plus d'informations.")
					}

					fs.writeFileSync(path.join(docsTempFolder.path, "vercel.json"), JSON.stringify({ framework: "nextjs" }))
					try { await execCommand("vercel deploy --prod --yes --force --no-wait --no-color", { cwd: docsTempFolder.path }) } catch (error) {
						log.error(`Impossible de compiler le projet avec "${packageManager} run build". ${error?.message || error}`)
						throw new Error(`Impossible de compiler le projet avec "${packageManager} run build".`)
					}
					fs.rmSync(path.join(docsTempFolder.path, "vercel.json"))

					return "Projet en cours de déploiement sur Vercel..."
				} else {
					log.info("Pour un déploiement automatique, vous pouvez :\n• Configurer Vercel dans votre projet à l'aide de la sous-commande \"create-vercel\"\n• Exécuter cet utilitaire depuis une intégration continue relié à votre dépôt Git")
					log.info("Pour déployer manuellement (serveur avec NodeJS + PM2), vous pouvez :\n• Copier l'ensemble des fichiers du dossier temporaire (hors node_modules) vers un serveur\n• Exécuter la commande \"npm install\" afin de télécharger les dépendances\n• Exécuter la commande \"npm run build\" afin de recompiler le projet\n• Exécuter la commande \"pm2 start npm --name 'markdocs-project' -- start\" afin de lancer le serveur")
					log.info(`Le dossier temporaire est situé à :\n${docsTempFolder.path}`)
				}
			},
		},
	].filter(Boolean))

	showNotif("MarkDocs CLI", "Le projet a été construit avec succès")
	outro(`Le projet a été construit avec succès à l'emplacement spécifié${deploymentMethod == "vercel" ? ", et sera déployé dans les prochaines minutes sur Vercel" : ""}.`)
}

if(command == "version" || command == "--version" || command == "-v") console.log(`MarkDocs v${require("./package.json").version}`)
else if(command == "help" || command == "--help" || command == "-h"){
	console.log(`
 Utilisation
   $ markdocs

 Sous commandes
   help                      Affiche cette page d'aide
   version                   Indique la version actuellement installée
   init                      Initialise un nouveau projet MarkDocs
   build                     Construit et déploie automatiquement un projet
   create-vercel             Créer un projet sur Vercel, et le lie à votre documentation

 Options
   --force                   Force l'exécution de certains éléments dans certaines commandes
   --reinit                  Construit la documentation "de zéro", sans utiliser les fichiers du précédent build
   --path                    Définit le chemin de votre projet MarkDocs

 Pour plus d'informations sur l'utilisation de MarkDocs, vous pouvez consulter sa documentation :
 ${picocolors.cyan("https://markdocs.johanstick.fr")}
`)
}
else if(command == "init") initialSetup()
else if(command == "build"){
	var projectPath = args.path
	buildProject(projectPath ? cleanPath(projectPath) : null)
}
else if(command == "create-vercel"){
	var projectPath = args.path
	createVercelProject(projectPath ? cleanPath(projectPath) : null)
}
else console.error("No command/invalid command specified! Use markdocs help.") && process.exit(1)