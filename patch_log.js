const fs = require('fs');
let code = fs.readFileSync('src/services/invoiceService.js', 'utf8');
code = code.replace(/if \(histories\.length > 0\)/, "console.log('Treatments found:', treatments, 'Histories found:', histories); if (histories.length > 0)");
fs.writeFileSync('src/services/invoiceService.js', code);
console.log('Patched');
