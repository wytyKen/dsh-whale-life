# NapCat 4.18.42 能力全景（OneBot action 清单）

> 提取自本仓库 NapCat 源码（tools/napcat，共 203 个 action 名 / 75 个带摘要的 handler）。
> 本文档是「鲸生行动能力」的选型底座：大脑（DSH 会话）决定做什么，身体（NapCat）执行。
> 调用方式统一为 OneBot HTTP/WS：`api.call(action, params)`。

## 消息收发（私聊/群聊）
- `send_msg` — 发送消息
- `send_group_msg` — 发送群消息
- `send_private_msg` — 发送私聊消息
- `send_forward_msg` — 发送合并转发消息
- `send_private_forward_msg` — 发送私聊合并转发消息
- `send_group_forward_msg` — 发送群合并转发消息
- `delete_msg`
- `get_msg`
- `get_friend_msg_history`
- `get_group_msg_history`
- `mark_private_msg_as_read` — 标记私聊已读
- `mark_group_msg_as_read` — 标记群聊已读
- `_mark_all_as_read` — 标记所有消息已读
- `set_msg_emoji_like` — 设置消息表情点赞
- `send_flash_msg`
- `forward_friend_single_msg`
- `forward_group_single_msg`

## QQ 空间（说说/动态）——鲸生「生活感」的核心
- `send_qzone_msg` — 发表QQ空间说说
- `delete_qzone_msg` — 删除QQ空间说说
- `get_qzone_feeds` — 获取QQ空间好友动态
- `get_qzone_msg_list` — 获取QQ空间说说列表
- `get_qzone_msg_detail` — 获取QQ空间说说详情
- `get_qzone_comment_list` — 获取QQ空间说说评论
- `get_qzone_comment_replies` — 获取QQ空间评论楼中楼回复
- `like_qzone` — 点赞QQ空间说说
- `unlike_qzone` — 取消QQ空间说说点赞
- `comment_qzone` — 评论QQ空间说说
- `get_qzone_profile` — 获取QQ空间资料
- `set_qzone_profile` — 修改QQ空间资料
- `set_qzone_msg_right` — 修改QQ空间说说权限
- `get_qzone_public_feeds` — 获取空友爱看动态
- `get_qzone_public_feed_detail` — 获取空友爱看动态详情
- `comment_qzone_public_feed` — 评论空友爱看动态
- `set_qzone_public_like` — 设置空友爱看普通赞

## 好友与社交
- `get_friends_with_category`
- `get_friend_list`
- `get_recent_contact`
- `get_profile_like`
- `friend_poke`
- `send_poke`
- `get_user_info`
- `get_stranger_info`
- `set_self_longnick`
- `set_qq_avatar`
- `get_unidirectional_friend_list`
- `get_doubt_friends_add_request`
- `set_doubt_friends_add_request`
- `handle_friend_request`
- `set_input_status`

## 群管理（高危：走审批）
- `get_group_list`
- `get_group_info`
- `get_group_member_list`
- `get_group_member_info`
- `set_group_kick`
- `set_group_ban`
- `set_group_whole_ban`
- `set_group_admin`
- `set_group_card`
- `set_group_special_title`
- `set_group_name`
- `leave_group`
- `set_group_portrait`
- `_send_group_notice`
- `_get_group_notice`
- `_del_group_notice`
- `set_group_sign`
- `send_group_sign`
- `get_group_signed_list` — 获取群组今日打卡列表
- `set_group_add_option` — 设置群加群选项
- `set_group_member_permissions`
- `get_group_detail_info`

## 群相册 / 群文件 / 群待办
- `get_qun_album_list` — 获取群相册列表
- `get_group_album_media_list` — 获取群相册媒体列表
- `upload_image_to_qun_album` — 上传图片到群相册
- `upload_images_to_qun_album` — 上传多张图片到群相册
- `del_group_album_media` — 删除群相册媒体
- `get_group_file_system_info`
- `get_group_root_files`
- `get_group_files_by_folder`
- `upload_group_file`
- `delete_group_file`
- `get_group_file_url`
- `create_group_file_folder`
- `set_group_todo` — 设置群待办
- `complete_group_todo` — 完成群待办

## 表情与贴纸
- `fetch_custom_face`
- `fetch_custom_face_detail`
- `add_custom_face`
- `delete_custom_face`
- `fetch_emoji_like` — 获取表情点赞详情
- `get_emoji_likes` — 获取消息表情点赞列表

## 在线状态与个人装扮
- `set_online_status`
- `set_diy_online_status`
- `nc_get_user_status`
- `set_self_longnick`
- `set_qq_avatar`

## 文件与流
- `upload_private_file`
- `upload_group_file`
- `download_file`
- `get_file` — 获取文件
- `upload_file_stream`
- `download_file_stream`
- `send_online_file`
- `get_online_file_msg`
- `receive_online_file`

## 系统 / 工具 / 频道
- `get_login_info`
- `get_version_info`
- `get_status`
- `nc_get_rkey`
- `get_clientkey`
- `translate_en2zh`
- `check_url_safely`
- `get_guild_list`
- `get_guild_service_profile`

## AI 语音 / 小程序 / 分享
- `get_ai_characters`
- `get_ai_record`
- `send_group_ai_record`
- `get_mini_app_ark`
- `get_share_link`
- `send_ark_share`
- `send_group_ark_share`

---

# 鲸生能力映射（v1 选型）

| 层 | 能力 | 实现 | 审批档 |
|---|---|---|---|
| 已有 | 私聊/群聊收发 | 透明管线 | semi 回复窗口 |
| **v1** | 发说说/动态 | send_qzone_msg | semi：主动发布默认草稿，主人放行 |
| **v1** | 读自己的动态流 | get_qzone_feeds | 只读，免审 |
| **v1** | 读动态评论 | get_qzone_comment_list | 只读，免审 |
| **v1** | 给好友动态点赞 | like_qzone | semi |
| **v1** | 回复动态评论 | comment_qzone | semi |
| v2 | 戳一戳好友 | friend_poke | semi |
| v2 | 改心情签名 | set_self_longnick | auto |
| v2 | 改在线状态 | set_online_status | auto |
| v2 | 群签到 | send_group_sign | auto |
| v2 | 加好友请求处理 | set_doubt_friends_add_request | 高危：一律主人裁决 |
| v3 | 群管理类 | 视需求 | 高危：一律主人裁决 |

设计原则：
- 只读类（拉列表/读动态/读评论）免审——她"看世界"不受限。
- 对外可见的写操作（发动态/评论/点赞/戳）走审批档 dry-run/semi/auto。
- 破坏性/治理类（踢人/禁言/删文件/处理加好友）永远"主人裁决"，无视审批档。
