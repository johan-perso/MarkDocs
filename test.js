var fs = require("fs")
var stream = fs.createWriteStream("aaa.txt")

var child = (require("child_process").spawn("node index.js", { shell: true, encoding: "utf8" }))

child.stdout.setEncoding("utf8")
child.stdout.on("data", data => {
	stream.write(data)
	console.log(data.toString())
})

child.stderr.setEncoding("utf8")
child.stderr.on("data", data => {
	stream.write(data)
	console.error(data.toString())
})
