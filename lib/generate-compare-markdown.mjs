import { writeFile } from 'fs/promises';

/**
 * Generate a Markdown comparison report from a comparison result object
 * @param {Object} comparison - The comparison result from compareReports()
 * @param {string} outputPath - Path to write the Markdown file
 * @returns {Promise<string>} - Path to the generated file
 */
const generateCompareMarkdown = async (comparison, outputPath) => {
  const md = buildMarkdown(comparison);
  await writeFile(outputPath, md);
  return outputPath;
};

/**
 * Format a repository URL for display
 * @param {string} url
 * @returns {string}
 */
const formatRepoUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  return url.replace(/\.git$/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git\+https:/, 'https:');
};

/**
 * Get emoji for severity level
 * @param {string} severity
 * @returns {string}
 */
const severityEmoji = (severity) => {
  switch (severity) {
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
};

/**
 * Get emoji for change type
 * @param {string} changeType
 * @returns {string}
 */
const changeTypeEmoji = (changeType) => {
  switch (changeType) {
    case 'major': return '🔴';
    case 'minor': return '🟡';
    case 'patch': return '🟢';
    default: return '⚪';
  }
};

/**
 * Build the full Markdown string
 * @param {Object} c - Comparison result
 * @returns {string}
 */
const buildMarkdown = (c) => {
  let out = '';

  // --- Header ---
  out += '# Dependency Change Comparison Report\n\n';

  const p1Repo = formatRepoUrl(c.project1.repository) || c.project1.repository;
  const p2Repo = formatRepoUrl(c.project2.repository) || c.project2.repository;

  out += '## Projects\n\n';
  out += '| | Project 1 | Project 2 |\n';
  out += '|---|---|---|\n';
  out += `| **Repository** | [${p1Repo}](${p1Repo}) | [${p2Repo}](${p2Repo}) |\n`;
  out += `| **Version Range** | ${c.project1.olderVersion} → ${c.project1.newerVersion} | ${c.project2.olderVersion} → ${c.project2.newerVersion} |\n`;
  out += `| **Report Generated** | ${new Date(c.project1.timestamp).toLocaleString()} | ${new Date(c.project2.timestamp).toLocaleString()} |\n`;
  out += '\n';

  // --- Filters applied ---
  if (c.options.excludePatterns?.length > 0 || c.options.includePatterns?.length > 0 || c.options.ignoreDev || c.options.includeNested) {
    out += '**Filters applied:**\n';
    if (c.options.excludePatterns?.length > 0) out += `- Excluding: \`${c.options.excludePatterns.join('`, `')}\`\n`;
    if (c.options.includePatterns?.length > 0) out += `- Including only: \`${c.options.includePatterns.join('`, `')}\`\n`;
    if (c.options.ignoreDev) out += '- DevDependencies excluded\n';
    if (c.options.includeNested) out += '- Nested dependencies included\n';
    out += '\n';
  }

  out += `**Comparison generated:** ${new Date(c.timestamp).toLocaleString()}\n\n`;

  // --- Summary ---
  out += '## Summary\n\n';

  if (c.summary.totalDiscrepancies === 0) {
    out += '**No discrepancies found.** All dependency changes are consistent between both projects.\n\n';
  } else {
    out += `**${c.summary.totalDiscrepancies} discrepancies** found, **${c.summary.totalMatching} matching** changes.\n\n`;

    out += '| Category | Count | Severity |\n';
    out += '|----------|-------|----------|\n';
    if (c.summary.addedOnlyInProject1 > 0) out += `| Added only in Project 1 | ${c.summary.addedOnlyInProject1} | 🔴 High |\n`;
    if (c.summary.addedOnlyInProject2 > 0) out += `| Added only in Project 2 | ${c.summary.addedOnlyInProject2} | 🔴 High |\n`;
    if (c.summary.removedOnlyInProject1 > 0) out += `| Removed only in Project 1 | ${c.summary.removedOnlyInProject1} | 🟡 Medium |\n`;
    if (c.summary.removedOnlyInProject2 > 0) out += `| Removed only in Project 2 | ${c.summary.removedOnlyInProject2} | 🟡 Medium |\n`;
    if (c.summary.versionMismatch > 0) out += `| Version mismatch (both upgraded differently) | ${c.summary.versionMismatch} | 🔴 Varies |\n`;
    if (c.summary.upgradeOnlyInProject1 > 0) out += `| Upgraded only in Project 1 | ${c.summary.upgradeOnlyInProject1} | 🟡 Varies |\n`;
    if (c.summary.upgradeOnlyInProject2 > 0) out += `| Upgraded only in Project 2 | ${c.summary.upgradeOnlyInProject2} | 🟡 Varies |\n`;
    if (c.summary.modifiedOnlyInProject1 > 0) out += `| Modified only in Project 1 | ${c.summary.modifiedOnlyInProject1} | 🟡 Medium |\n`;
    if (c.summary.modifiedOnlyInProject2 > 0) out += `| Modified only in Project 2 | ${c.summary.modifiedOnlyInProject2} | 🟡 Medium |\n`;
    out += '\n';
  }

  // --- Discrepancy sections ---
  const d = c.discrepancies;

  // Added only in Project 1
  if (d.addedOnlyInProject1.length > 0) {
    out += '## 📦 Added Only in Project 1\n\n';
    out += 'These dependencies were added in Project 1 but **not** in Project 2.\n\n';
    out += '| Package | Version | Severity |\n';
    out += '|---------|---------|----------|\n';
    for (const dep of d.addedOnlyInProject1) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      out += `| [${dep.name}](${npmUrl}) | ${dep.version} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Added only in Project 2
  if (d.addedOnlyInProject2.length > 0) {
    out += '## 📦 Added Only in Project 2\n\n';
    out += 'These dependencies were added in Project 2 but **not** in Project 1.\n\n';
    out += '| Package | Version | Severity |\n';
    out += '|---------|---------|----------|\n';
    for (const dep of d.addedOnlyInProject2) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      out += `| [${dep.name}](${npmUrl}) | ${dep.version} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Removed only in Project 1
  if (d.removedOnlyInProject1.length > 0) {
    out += '## 🗑️ Removed Only in Project 1\n\n';
    out += 'These dependencies were removed in Project 1 but **not** in Project 2.\n\n';
    out += '| Package | Version | Severity |\n';
    out += '|---------|---------|----------|\n';
    for (const dep of d.removedOnlyInProject1) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      out += `| [${dep.name}](${npmUrl}) | ${dep.version} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Removed only in Project 2
  if (d.removedOnlyInProject2.length > 0) {
    out += '## 🗑️ Removed Only in Project 2\n\n';
    out += 'These dependencies were removed in Project 2 but **not** in Project 1.\n\n';
    out += '| Package | Version | Severity |\n';
    out += '|---------|---------|----------|\n';
    for (const dep of d.removedOnlyInProject2) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      out += `| [${dep.name}](${npmUrl}) | ${dep.version} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Version mismatch
  if (d.versionMismatch.length > 0) {
    out += '## ⚠️ Version Mismatches\n\n';
    out += 'Both projects upgraded these dependencies, but to **different versions**.\n\n';
    out += '| Package | Project 1 | Project 2 | Severity |\n';
    out += '|---------|-----------|-----------|----------|\n';
    for (const dep of d.versionMismatch) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      const p1 = `${dep.project1.oldVersion} → ${dep.project1.newVersion} ${changeTypeEmoji(dep.project1.changeType)} ${dep.project1.changeType}`;
      const p2 = `${dep.project2.oldVersion} → ${dep.project2.newVersion} ${changeTypeEmoji(dep.project2.changeType)} ${dep.project2.changeType}`;
      out += `| [${dep.name}](${npmUrl}) | ${p1} | ${p2} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Upgraded only in Project 1
  if (d.upgradeOnlyInProject1.length > 0) {
    out += '## ⬆️ Upgraded Only in Project 1\n\n';
    out += 'These dependencies were upgraded in Project 1 but **not** in Project 2.\n\n';
    out += '| Package | Old Version | New Version | Change Type | Severity |\n';
    out += '|---------|-------------|-------------|-------------|----------|\n';
    for (const dep of d.upgradeOnlyInProject1) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      out += `| [${dep.name}](${npmUrl}) | ${dep.project1.oldVersion} | ${dep.project1.newVersion} | ${changeTypeEmoji(dep.project1.changeType)} ${dep.project1.changeType} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Upgraded only in Project 2
  if (d.upgradeOnlyInProject2.length > 0) {
    out += '## ⬆️ Upgraded Only in Project 2\n\n';
    out += 'These dependencies were upgraded in Project 2 but **not** in Project 1.\n\n';
    out += '| Package | Old Version | New Version | Change Type | Severity |\n';
    out += '|---------|-------------|-------------|-------------|----------|\n';
    for (const dep of d.upgradeOnlyInProject2) {
      const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
      out += `| [${dep.name}](${npmUrl}) | ${dep.project2.oldVersion} | ${dep.project2.newVersion} | ${changeTypeEmoji(dep.project2.changeType)} ${dep.project2.changeType} | ${severityEmoji(dep.severity)} ${dep.severity} |\n`;
    }
    out += '\n';
  }

  // Modified only in Project 1
  if (d.modifiedOnlyInProject1.length > 0) {
    out += '## 🔄 Modified Only in Project 1\n\n';
    out += 'These dependencies had namespace changes in Project 1 but **not** in Project 2.\n\n';
    out += '| Old Package | New Package | Old Version | New Version |\n';
    out += '|-------------|-------------|-------------|-------------|\n';
    for (const dep of d.modifiedOnlyInProject1) {
      out += `| ${dep.oldName} | ${dep.newName} | ${dep.oldVersion} | ${dep.newVersion} |\n`;
    }
    out += '\n';
  }

  // Modified only in Project 2
  if (d.modifiedOnlyInProject2.length > 0) {
    out += '## 🔄 Modified Only in Project 2\n\n';
    out += 'These dependencies had namespace changes in Project 2 but **not** in Project 1.\n\n';
    out += '| Old Package | New Package | Old Version | New Version |\n';
    out += '|-------------|-------------|-------------|-------------|\n';
    for (const dep of d.modifiedOnlyInProject2) {
      out += `| ${dep.oldName} | ${dep.newName} | ${dep.oldVersion} | ${dep.newVersion} |\n`;
    }
    out += '\n';
  }

  // --- Nested discrepancies ---
  if (c.nested) {
    const n = c.nested;
    const hasNested =
      n.addedOnlyInProject1.length > 0 ||
      n.addedOnlyInProject2.length > 0 ||
      n.removedOnlyInProject1.length > 0 ||
      n.removedOnlyInProject2.length > 0 ||
      n.versionMismatch.length > 0 ||
      n.upgradeOnlyInProject1.length > 0 ||
      n.upgradeOnlyInProject2.length > 0;

    if (hasNested) {
      out += '## Nested Dependency Discrepancies\n\n';

      if (n.addedOnlyInProject1.length > 0) {
        out += '### Nested Added Only in Project 1\n\n';
        out += '| Package | Version | Parent |\n';
        out += '|---------|---------|--------|\n';
        for (const dep of n.addedOnlyInProject1) {
          out += `| ${dep.name} | ${dep.version} | ${dep.parent} |\n`;
        }
        out += '\n';
      }

      if (n.addedOnlyInProject2.length > 0) {
        out += '### Nested Added Only in Project 2\n\n';
        out += '| Package | Version | Parent |\n';
        out += '|---------|---------|--------|\n';
        for (const dep of n.addedOnlyInProject2) {
          out += `| ${dep.name} | ${dep.version} | ${dep.parent} |\n`;
        }
        out += '\n';
      }

      if (n.removedOnlyInProject1.length > 0) {
        out += '### Nested Removed Only in Project 1\n\n';
        out += '| Package | Version | Parent |\n';
        out += '|---------|---------|--------|\n';
        for (const dep of n.removedOnlyInProject1) {
          out += `| ${dep.name} | ${dep.version} | ${dep.parent} |\n`;
        }
        out += '\n';
      }

      if (n.removedOnlyInProject2.length > 0) {
        out += '### Nested Removed Only in Project 2\n\n';
        out += '| Package | Version | Parent |\n';
        out += '|---------|---------|--------|\n';
        for (const dep of n.removedOnlyInProject2) {
          out += `| ${dep.name} | ${dep.version} | ${dep.parent} |\n`;
        }
        out += '\n';
      }

      if (n.versionMismatch.length > 0) {
        out += '### Nested Version Mismatches\n\n';
        out += '| Package | Project 1 | Project 2 |\n';
        out += '|---------|-----------|----------|\n';
        for (const dep of n.versionMismatch) {
          const p1 = `${dep.project1.oldVersion} → ${dep.project1.newVersion} (${dep.project1.parent})`;
          const p2 = `${dep.project2.oldVersion} → ${dep.project2.newVersion} (${dep.project2.parent})`;
          out += `| ${dep.name} | ${p1} | ${p2} |\n`;
        }
        out += '\n';
      }

      if (n.upgradeOnlyInProject1.length > 0) {
        out += '### Nested Upgraded Only in Project 1\n\n';
        out += '| Package | Old Version | New Version | Parent |\n';
        out += '|---------|-------------|-------------|--------|\n';
        for (const dep of n.upgradeOnlyInProject1) {
          out += `| ${dep.name} | ${dep.project1.oldVersion} | ${dep.project1.newVersion} | ${dep.project1.parent} |\n`;
        }
        out += '\n';
      }

      if (n.upgradeOnlyInProject2.length > 0) {
        out += '### Nested Upgraded Only in Project 2\n\n';
        out += '| Package | Old Version | New Version | Parent |\n';
        out += '|---------|-------------|-------------|--------|\n';
        for (const dep of n.upgradeOnlyInProject2) {
          out += `| ${dep.name} | ${dep.project2.oldVersion} | ${dep.project2.newVersion} | ${dep.project2.parent} |\n`;
        }
        out += '\n';
      }
    }
  }

  // --- Matching changes (collapsible) ---
  const m = c.matching;
  const hasMatching = m.added.length > 0 || m.removed.length > 0 || m.upgraded.length > 0 || m.modified.length > 0;

  if (hasMatching) {
    out += '## Matching Changes\n\n';
    out += 'These changes were consistent across both projects.\n\n';
    out += '<details>\n<summary>Click to expand matching changes</summary>\n\n';

    if (m.added.length > 0) {
      out += '### Matching Additions\n\n';
      out += '| Package | Project 1 Version | Project 2 Version | Versions Match |\n';
      out += '|---------|-------------------|-------------------|----------------|\n';
      for (const dep of m.added) {
        const match = dep.versionsMatch ? '✅' : '⚠️';
        out += `| ${dep.name} | ${dep.project1.version} | ${dep.project2.version} | ${match} |\n`;
      }
      out += '\n';
    }

    if (m.removed.length > 0) {
      out += '### Matching Removals\n\n';
      out += '| Package | Project 1 Version | Project 2 Version |\n';
      out += '|---------|-------------------|-------------------|\n';
      for (const dep of m.removed) {
        out += `| ${dep.name} | ${dep.project1.version} | ${dep.project2.version} |\n`;
      }
      out += '\n';
    }

    if (m.upgraded.length > 0) {
      out += '### Matching Upgrades\n\n';
      out += '| Package | Version Change | Change Type |\n';
      out += '|---------|---------------|-------------|\n';
      for (const dep of m.upgraded) {
        out += `| ${dep.name} | ${dep.project1.oldVersion} → ${dep.project1.newVersion} | ${changeTypeEmoji(dep.project1.changeType)} ${dep.project1.changeType} |\n`;
      }
      out += '\n';
    }

    if (m.modified.length > 0) {
      out += '### Matching Modifications\n\n';
      out += '| Old Name | New Name |\n';
      out += '|----------|----------|\n';
      for (const dep of m.modified) {
        out += `| ${dep.project1.oldName} | ${dep.project1.newName} |\n`;
      }
      out += '\n';
    }

    out += '</details>\n\n';
  }

  // --- Filtered packages ---
  if (c.filtered.length > 0) {
    out += '## Filtered Packages\n\n';
    out += `${c.filtered.length} package(s) were excluded from comparison.\n\n`;
    out += '<details>\n<summary>Click to expand filtered packages</summary>\n\n';
    out += '| Package | Reason |\n';
    out += '|---------|--------|\n';
    for (const item of c.filtered) {
      out += `| ${item.name} | ${item.reason} |\n`;
    }
    out += '\n</details>\n\n';
  }

  return out;
};

export { generateCompareMarkdown };
