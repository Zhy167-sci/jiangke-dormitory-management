# 第三方组件声明

本项目自己的代码采用 MIT 许可证。以下组件仍分别遵循其原始许可证，内置文件中的版权头不得删除。

| 组件 | 用途 | 项目地址 | 许可证 |
|---|---|---|---|
| ExcelJS 4.4.0 | 浏览器端生成带样式 Excel | https://github.com/exceljs/exceljs | MIT |
| JSZip 3.10.1 | ZIP 读取与生成 | https://github.com/Stuk/jszip | MIT 或 GPLv3 双许可，本项目选择 MIT |
| SheetJS Community 0.18.5 | `.xls/.xlsx` 解析 | https://sheetjs.com/ | Apache-2.0 |
| openpyxl 3.1.5 | Python 读写 `.xlsx` | https://openpyxl.readthedocs.io/ | MIT |
| xlrd 2.0.2 | Python 读取旧版 `.xls` | https://github.com/python-excel/xlrd | BSD-3-Clause |

`web/vendor.bundle.js` 还包含这些库的传递依赖，其原始版权和许可注释保留在文件中。重新打包或升级依赖时，应同步核对本声明及完整许可证文本。
