# Chrome 密码提取脚本使用说明

## 功能特性

- ✅ 跨平台支持（macOS、Windows、Linux）
- ✅ 使用系统原生解密 API
- ✅ macOS: 自动调用 Keychain 授权弹窗
- ✅ Windows: 使用 DPAPI 解密
- ✅ Linux: 支持 Chrome 默认加密
- ✅ 安全：需要用户手动输入系统密码确认

## 安装依赖

```bash
# 安装加密库
pip install pycryptodome

# Windows 额外需要
pip install pywin32
```

## 使用方法

```bash
python extract_chrome_passwords.py
```

## 运行流程

1. 脚本会检测您的操作系统
2. 找到 Chrome 的 Login Data 数据库
3. **触发系统授权弹窗**（macOS 会要求输入密码）
4. 解密并显示所有保存的账号密码
5. 可选择保存到 JSON 文件

## macOS 授权说明

在 macOS 上运行时，会弹出系统对话框：

```
"security wants to use your confidential information stored in 'Chrome Safe Storage' in your keychain"
```

输入您的 macOS 用户密码即可授权。

## 注意事项

⚠️ **重要安全提示：**

1. 此脚本仅用于提取**您自己**的密码
2. 系统会通过密码确认您的身份
3. 请在安全环境下运行
4. 导出的 JSON 文件包含明文密码，请妥善保管
5. 建议使用后立即删除导出文件

## 系统路径

脚本会自动查找以下路径：

- **macOS**: `~/Library/Application Support/Google/Chrome/Default/Login Data`
- **Windows**: `%USERPROFILE%\AppData\Local\Google\Chrome\User Data\Default\Login Data`
- **Linux**: `~/.config/google-chrome/Default/Login Data`

## 技术细节

### macOS
- 使用 `security find-generic-password` 命令访问 Keychain
- 通过 PBKDF2 派生 AES 密钥
- AES-CBC 解密密码

### Windows
- 读取 `Local State` 文件获取加密密钥
- 使用 DPAPI 解密主密钥
- AES-GCM 解密密码（Chrome v80+）

### Linux
- 使用固定密钥 'peanuts'
- PBKDF2 派生密钥
- AES-CBC 解密

## 输出格式

```json
[
  {
    "url": "https://example.com",
    "username": "user@example.com",
    "password": "your_password"
  }
]
```

## 故障排除

### 错误：找不到 Chrome 数据库
- 确保 Chrome 已安装
- 检查 Chrome 配置文件路径

### 错误：无法访问 Keychain (macOS)
- 点击授权对话框时选择"允许"
- 输入正确的 macOS 用户密码

### 错误：无法复制数据库
- 关闭所有 Chrome 窗口后重试

### 解密失败
- 确保使用当前登录的系统用户账号
- 检查 Chrome 版本是否支持

## 合法性声明

此脚本仅供学习和个人数据管理使用。未经授权访问他人密码是违法行为。
