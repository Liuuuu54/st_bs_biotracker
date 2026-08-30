function parseRegexLiteral(source) {
	const text = String(source ?? "").trim();

	if (!text) {
		return {
			regex: null,
			error: "",
		};
	}

	if (text.startsWith("/")) {
		let escaped = false;

		for (let index = 1; index < text.length; index += 1) {
			const char = text[index];

			if (escaped) {
				escaped = false;
				continue;
			}

			if (char === "\\") {
				escaped = true;
				continue;
			}

			if (char !== "/") continue;

			const pattern = text.slice(1, index);
			const flags = text.slice(index + 1);

			try {
				return {
					regex: new RegExp(pattern, flags),
					error: "",
				};
			} catch (error) {
				return {
					regex: null,
					error: String(error?.message || error),
				};
			}
		}
	}

	try {
		return {
			regex: new RegExp(text),
			error: "",
		};
	} catch (error) {
		return {
			regex: null,
			error: String(error?.message || error),
		};
	}
}

function getFirstCaptureGroup(match) {
	if (!Array.isArray(match) || match.length <= 1) {
		return String(match?.[0] ?? "");
	}

	for (let index = 1; index < match.length; index += 1) {
		if (match[index] !== undefined) {
			return String(match[index]);
		}
	}

	return "";
}

function extractWithRegex(text, regex) {
	regex.lastIndex = 0;

	if (!regex.global) {
		const match = regex.exec(text);
		return match ? getFirstCaptureGroup(match) : "";
	}

	const results = [];

	while (true) {
		const match = regex.exec(text);

		if (!match) break;

		results.push(getFirstCaptureGroup(match));

		if (match[0] === "") {
			regex.lastIndex += 1;
		}
	}

	return results.join("\n");
}

function applyRegexRule(text, rule) {
	const source = String(rule?.regex ?? "").trim();

	if (!source) {
		return {
			text,
			error: "",
		};
	}

	const parsed = parseRegexLiteral(source);

	if (parsed.error) {
		return {
			text,
			error: parsed.error,
		};
	}

	if (!parsed.regex) {
		return {
			text,
			error: "",
		};
	}

	if (rule.mode === "exclude") {
		parsed.regex.lastIndex = 0;

		return {
			text: text.replace(parsed.regex, ""),
			error: "",
		};
	}

	return {
		text: extractWithRegex(text, parsed.regex),
		error: "",
	};
}

export function applyMessageRegexRules(text, rules) {
	let result = String(text ?? "");
	const errors = [];

	const list = Array.isArray(rules) ? rules : [];

	for (const rule of list) {
		if (!rule || rule.enabled === false) continue;

		const applied = applyRegexRule(result, rule);

		result = applied.text;

		if (applied.error) {
			errors.push({
				id: String(rule.id || ""),
				regex: String(rule.regex || ""),
				error: applied.error,
			});
		}
	}

	return {
		text: result,
		errors,
	};
}
