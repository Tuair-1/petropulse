#!/bin/bash
# git askpass: 用户名固定,密码从临时令牌文件读取(用完即删)
if [[ "$1" == *"Username"* ]]; then
  echo "Tuair-1"
else
  cat "/c/Users/Tuhao/AppData/Local/Temp/petropulse_gh_token.txt"
fi
