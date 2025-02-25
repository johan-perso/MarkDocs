var { readdirSync, statSync } = require("fs")
var { join, basename } = require("path")

function walkRecursive(dir, ignoreNodeModules = false, ignoreDotFiles = false){
	var results = []
	var list = readdirSync(dir)
	if(!list) return results
	for(var i = 0; i < list.length; i++){
		var file = join(dir, list[i])
		var stat = statSync(file)
		if(!stat) continue
		var isDirectory = stat && stat.isDirectory()

		if(isDirectory && basename(file) == "_markdocs"){ // on ajoute le dossier _markdocs mais on ne le parcourt pas
			results.push(file)
			continue
		}
		if(isDirectory && basename(file) == "node_modules" && ignoreNodeModules){ // si on ignore les node_modules, on ajoute le dossier mais on ne le parcourt pas
			results.push(file)
			continue
		}
		if(ignoreDotFiles && basename(file).startsWith(".")) continue // si on ignore les fichiers commençant par un point, on passe au suivant (on ne les ajoute pas dans results)

		if(isDirectory) results = results.concat(walkRecursive(file))
		else results.push(file)
	}
	return results
}

module.exports = walkRecursive