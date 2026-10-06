
const fs = require('fs');
let code = fs.readFileSync('src/controllers/treatmentController.js', 'utf8');

const newFuncs = 'const getList = async (req, res) => {\\n    try {\\n        const tenantId = req.user.tenant_id;\\n        const result = await treatmentService.getTreatments(tenantId, req.query, req.user.system_role, req.user.branch_id);\\n        res.status(200).json({ message: \\'Lấy danh sách liệu trình thành công\\', ...result });\\n    } catch (error) {\\n        res.status(500).json({ message: error.message });\\n    }\\n};\\n\\nconst getDetail = async (req, res) => {\\n    try {\\n        const tenantId = req.user.tenant_id;\\n        const result = await treatmentService.getTreatmentDetail(tenantId, req.params.id, req.user.system_role, req.user.branch_id);\\n        res.status(200).json({ message: \\'Lấy chi tiết liệu trình thành công\\', data: result });\\n    } catch (error) {\\n        if (error.message.includes(\\'Không tìm thấy\\')) return res.status(404).json({ message: error.message });\\n        res.status(500).json({ message: error.message });\\n    }\\n};\\n';

code = code.replace(/const executeSession/, newFuncs + '\\nconst executeSession');
code = code.replace(/module.exports = \\{/, 'module.exports = {\\n    getList,\\n    getDetail,');
fs.writeFileSync('src/controllers/treatmentController.js', code);

