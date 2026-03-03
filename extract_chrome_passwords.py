#!/usr/bin/env python3
"""
Chrome 密码提取脚本
支持 macOS、Windows 和 Linux
使用系统原生的密钥解密 API
"""

import os
import sys
import sqlite3
import shutil
import json
from pathlib import Path
import base64


def get_chrome_db_path():
    """获取 Chrome Login Data 数据库路径"""
    system = sys.platform

    if system == "darwin":  # macOS
        return os.path.expanduser("~/Library/Application Support/Google/Chrome/Default/Login Data")
    elif system == "win32":  # Windows
        return os.path.join(os.environ["USERPROFILE"],
                           "AppData", "Local", "Google", "Chrome", "User Data", "Default", "Login Data")
    elif system.startswith("linux"):  # Linux
        return os.path.expanduser("~/.config/google-chrome/Default/Login Data")
    else:
        raise OSError(f"不支持的操作系统: {system}")


def get_encryption_key_macos():
    """
    macOS: 使用 keychain 获取 Chrome 的加密密钥
    需要用户授权（会弹出系统密码输入框）
    """
    import subprocess

    try:
        # 调用 security 命令访问 keychain
        # 这会触发系统弹窗要求用户输入密码授权
        result = subprocess.run(
            ["security", "find-generic-password",
             "-wa", "Chrome"],
            capture_output=True,
            text=True,
            check=True
        )

        password = result.stdout.strip()
        if not password:
            raise ValueError("无法从 Keychain 获取密钥")

        # Chrome 使用 PBKDF2 派生密钥
        from Crypto.Protocol.KDF import PBKDF2
        key = PBKDF2(password, b'saltysalt', dkLen=16, count=1003)
        return key

    except subprocess.CalledProcessError as e:
        print(f"错误: 无法访问 macOS Keychain")
        print(f"请确保授权此脚本访问 Keychain")
        sys.exit(1)


def get_encryption_key_windows():
    """
    Windows: 使用 DPAPI 解密 Chrome 的加密密钥
    会自动使用当前用户的凭据
    """
    import win32crypt

    local_state_path = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Local State"
    )

    try:
        with open(local_state_path, 'r', encoding='utf-8') as f:
            local_state = json.load(f)

        encrypted_key = base64.b64decode(local_state["os_crypt"]["encrypted_key"])
        # 移除 'DPAPI' 前缀
        encrypted_key = encrypted_key[5:]

        # 使用 DPAPI 解密（会触发用户授权）
        key = win32crypt.CryptUnprotectData(encrypted_key, None, None, None, 0)[1]
        return key

    except Exception as e:
        print(f"错误: 无法获取 Windows 加密密钥: {e}")
        sys.exit(1)


def get_encryption_key_linux():
    """
    Linux: Chrome 使用固定的密钥 'peanuts'
    """
    from Crypto.Protocol.KDF import PBKDF2
    key = PBKDF2(b'peanuts', b'saltysalt', dkLen=16, count=1)
    return key


def get_encryption_key():
    """根据操作系统获取解密密钥"""
    system = sys.platform

    if system == "darwin":
        return get_encryption_key_macos()
    elif system == "win32":
        return get_encryption_key_windows()
    elif system.startswith("linux"):
        return get_encryption_key_linux()
    else:
        raise OSError(f"不支持的操作系统: {system}")


def decrypt_password(encrypted_password, key):
    """解密 Chrome 保存的密码"""
    try:
        if sys.platform == "win32":
            # Windows (v80+): 使用 AES-GCM
            from Crypto.Cipher import AES

            # 检查是否是新版加密格式 (v10)
            if encrypted_password[:3] == b'v10':
                # 移除 'v10' 前缀
                encrypted_password = encrypted_password[3:]
                # nonce 是前 12 字节
                nonce = encrypted_password[:12]
                # 密文是剩余部分（不包括最后16字节的认证标签）
                ciphertext = encrypted_password[12:]

                cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
                decrypted = cipher.decrypt(ciphertext)
                # 移除填充的认证标签 (最后16字节)
                decrypted = decrypted[:-16]
                return decrypted.decode('utf-8')
            else:
                # 旧版 DPAPI 加密
                import win32crypt
                return win32crypt.CryptUnprotectData(encrypted_password, None, None, None, 0)[1].decode('utf-8')
        else:
            # macOS/Linux: 使用 AES-CBC (128位)
            from Crypto.Cipher import AES

            # 移除前缀 (v10 或 v11)
            if encrypted_password[:3] == b'v10' or encrypted_password[:3] == b'v11':
                encrypted_password = encrypted_password[3:]

            # IV 是前 16 字节
            iv = b' ' * 16
            cipher = AES.new(key, AES.MODE_CBC, iv)
            decrypted = cipher.decrypt(encrypted_password)

            # 移除 PKCS7 填充
            padding_length = decrypted[-1]
            decrypted = decrypted[:-padding_length]

            return decrypted.decode('utf-8')

    except Exception as e:
        print(f"解密失败: {e}")
        return ""


def extract_passwords():
    """提取 Chrome 保存的所有密码"""

    print("=" * 60)
    print("Chrome 密码提取工具")
    print("=" * 60)
    print()

    # 获取数据库路径
    db_path = get_chrome_db_path()

    if not os.path.exists(db_path):
        print(f"错误: 找不到 Chrome 数据库")
        print(f"路径: {db_path}")
        print("请确保 Chrome 已安装并至少运行过一次")
        sys.exit(1)

    print(f"✓ 找到 Chrome 数据库: {db_path}")
    print()

    # 复制数据库（因为 Chrome 可能正在使用）
    temp_db = "temp_login_data.db"
    try:
        shutil.copy2(db_path, temp_db)
    except Exception as e:
        print(f"错误: 无法复制数据库: {e}")
        print("请关闭 Chrome 后重试")
        sys.exit(1)

    print("⚠️  正在请求系统授权...")
    print("请在弹出的系统对话框中输入您的密码以授权访问")
    print()

    # 获取解密密钥（这里会触发系统授权）
    try:
        key = get_encryption_key()
        print("✓ 成功获取解密密钥")
        print()
    except Exception as e:
        if os.path.exists(temp_db):
            os.remove(temp_db)
        print(f"错误: {e}")
        sys.exit(1)

    # 连接数据库并查询
    try:
        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT origin_url, username_value, password_value
            FROM logins
            ORDER BY date_created DESC
        """)

        results = cursor.fetchall()

        if not results:
            print("没有找到保存的密码")
            conn.close()
            os.remove(temp_db)
            sys.exit(0)

        print(f"找到 {len(results)} 条密码记录")
        print("=" * 60)
        print()

        passwords = []
        for url, username, encrypted_password in results:
            if username and encrypted_password:
                password = decrypt_password(encrypted_password, key)
                if password:
                    passwords.append({
                        'url': url,
                        'username': username,
                        'password': password
                    })

                    print(f"网站: {url}")
                    print(f"用户名: {username}")
                    print(f"密码: {password}")
                    print("-" * 60)

        conn.close()
        os.remove(temp_db)

        print()
        print(f"✓ 成功提取 {len(passwords)} 条密码")

        # 询问是否保存到文件
        print()
        save = input("是否保存到文件? (y/n): ").strip().lower()
        if save == 'y':
            output_file = "chrome_passwords.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(passwords, f, ensure_ascii=False, indent=2)
            print(f"✓ 已保存到: {output_file}")
            print("⚠️  请妥善保管此文件，建议加密存储")

    except Exception as e:
        print(f"错误: 数据库查询失败: {e}")
        if os.path.exists(temp_db):
            os.remove(temp_db)
        sys.exit(1)


def check_dependencies():
    """检查必要的依赖"""
    missing = []

    try:
        from Crypto.Cipher import AES
        from Crypto.Protocol.KDF import PBKDF2
    except ImportError:
        missing.append("pycryptodome")

    if sys.platform == "win32":
        try:
            import win32crypt
        except ImportError:
            missing.append("pywin32")

    if missing:
        print("缺少必要的依赖包，请运行以下命令安装：")
        print()
        print(f"pip install {' '.join(missing)}")
        print()
        sys.exit(1)


if __name__ == "__main__":
    print()
    print("⚠️  重要提示:")
    print("1. 此脚本仅用于提取您自己的密码")
    print("2. 系统会要求您输入密码进行授权")
    print("3. 请确保在安全的环境下运行")
    print()

    confirm = input("继续? (y/n): ").strip().lower()
    if confirm != 'y':
        print("已取消")
        sys.exit(0)

    print()

    # 检查依赖
    check_dependencies()

    # 提取密码
    extract_passwords()
