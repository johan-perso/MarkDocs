module.exports = function (value, returnOnlyFalse = false){
	if(value === "") return

	var valid = false
	try {
		new URL(value)
		valid = true
	} catch (error) {
		valid = false
	}

	if(returnOnlyFalse && !valid) return "L'URL semble invalide ou mal formée"
	else if(!returnOnlyFalse) return valid
}