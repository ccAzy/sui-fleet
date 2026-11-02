package sub

import (
	"encoding/base64"
	"fmt"
	"gorm.io/gorm"
	"strings"
	"time"

	"github.com/alireza0/s-ui/database"
	"github.com/alireza0/s-ui/database/model"
	"github.com/alireza0/s-ui/service"
	"github.com/alireza0/s-ui/util"
)

type SubService struct {
	service.SettingService
	LinkService
}

func (s *SubService) GetSubs(subId string) (*string, []string, error) {
	var err error

	client, err := s.getClientBySubId(subId)
	if err != nil {
		return nil, nil, err
	}

	clientInfo := ""
	subShowInfo, _ := s.SettingService.GetSubShowInfo()
	if subShowInfo {
		clientInfo = s.getClientInfo(client)
	}

	linksArray := s.LinkService.GetLinks(&client.Links, "all", clientInfo)
	result := strings.Join(linksArray, "\n")

	headers := s.getClientHeaders(client)

	subEncode, _ := s.SettingService.GetSubEncode()
	if subEncode {
		result = base64.StdEncoding.EncodeToString([]byte(result))
	}

	return &result, headers, nil
}

// isSubTokenShape 判断这串是不是订阅令牌的形状：32 位小写 hex。
//
// 为什么要形状判断而不是"先按令牌查、查不到再按名字"：
// 否则一个客户端把名字起成 32 位 hex 就能遮蔽令牌查询；而且"查不到就回退"
// 会让攻击者用令牌格式的垃圾去试探名字空间。
func isSubTokenShape(s string) bool {
	if len(s) != 32 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// FindClientBySubID 按订阅标识找客户端：令牌优先，客户端名作为 legacy 兼容。
//
// 令牌形状的串**只**按令牌查，查不到直接 not found，不回退按名字。
// 名字查询受 subLegacyNameAccess 开关控制（默认开，给老订阅留宽限期）。
func FindClientBySubID(subID string, allowLegacyName bool) (*model.Client, error) {
	db := database.GetDB()
	client := &model.Client{}
	if isSubTokenShape(subID) {
		err := db.Model(model.Client{}).
			Where("enable = true and sub_token = ?", subID).
			First(client).Error
		return clientOrNil(client, err)
	}
	if !allowLegacyName {
		return nil, gorm.ErrRecordNotFound
	}
	err := db.Model(model.Client{}).
		Where("enable = true and name = ?", subID).
		First(client).Error
	return clientOrNil(client, err)
}

func clientOrNil(c *model.Client, err error) (*model.Client, error) {
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (j *SubService) getClientBySubId(subId string) (*model.Client, error) {
	return FindClientBySubID(subId, j.SettingService.GetSubLegacyNameAccess())
}

func (s *SubService) getClientHeaders(client *model.Client) []string {
	updateInterval, _ := s.SettingService.GetSubUpdates()
	return util.GetHeaders(client, updateInterval)
}

func (s *SubService) getClientInfo(c *model.Client) string {
	now := time.Now().Unix()

	var result []string
	if vol := c.Volume - (c.Up + c.Down); vol > 0 {
		result = append(result, fmt.Sprintf("%s%s", s.formatTraffic(vol), "📊"))
	}
	if c.Expiry > 0 {
		result = append(result, fmt.Sprintf("%d%s⏳", (c.Expiry-now)/86400, "Days"))
	}
	if len(result) > 0 {
		return " " + strings.Join(result, " ")
	} else {
		return " ♾"
	}
}

func (s *SubService) formatTraffic(trafficBytes int64) string {
	if trafficBytes < 1024 {
		return fmt.Sprintf("%.2fB", float64(trafficBytes)/float64(1))
	} else if trafficBytes < (1024 * 1024) {
		return fmt.Sprintf("%.2fKB", float64(trafficBytes)/float64(1024))
	} else if trafficBytes < (1024 * 1024 * 1024) {
		return fmt.Sprintf("%.2fMB", float64(trafficBytes)/float64(1024*1024))
	} else if trafficBytes < (1024 * 1024 * 1024 * 1024) {
		return fmt.Sprintf("%.2fGB", float64(trafficBytes)/float64(1024*1024*1024))
	} else if trafficBytes < (1024 * 1024 * 1024 * 1024 * 1024) {
		return fmt.Sprintf("%.2fTB", float64(trafficBytes)/float64(1024*1024*1024*1024))
	} else {
		return fmt.Sprintf("%.2fEB", float64(trafficBytes)/float64(1024*1024*1024*1024*1024))
	}
}
