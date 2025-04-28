const childProcess = require("child_process")

module.exports.execCommand = async function (command, options = { cwd: process.cwd() }){
	return new Promise((resolve, reject) => {
		childProcess.exec(command, options, (error, stdout, stderr) => {
			if(error) reject(error)
			else resolve(stdout)
		})
	})
}

module.exports.spawnCommand = async function (command, args, options = { cwd: process.cwd() }){
	return new Promise((resolve, reject) => {
		const process = childProcess.spawn(command, args, {
			...options,
			stdio: ["inherit", "inherit", "inherit"]
		})

		process.on("error", (error) => { reject(error) })

		process.on("close", (code) => {
			if (code === 0) resolve(code)
			else reject(new Error(`Process exited with code ${code}`))
		})
	})
}