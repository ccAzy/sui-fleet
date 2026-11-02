package model

import (
	"encoding/json"
	"fmt"
)

type Endpoint struct {
	Id      uint            `json:"id" form:"id" gorm:"primaryKey;autoIncrement"`
	Type    string          `json:"type" form:"type"`
	Tag     string          `json:"tag" form:"tag" gorm:"unique"`
	Options json.RawMessage `json:"-" form:"-"`
	Ext     json.RawMessage `json:"ext" form:"ext"`
}

func (o *Endpoint) UnmarshalJSON(data []byte) error {
	var err error
	var raw map[string]interface{}
	if err = json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// Extract fixed fields and store the rest in Options
	if val, exists := raw["id"].(float64); exists {
		o.Id = uint(val)
	}
	delete(raw, "id")
	o.Type, _ = raw["type"].(string)
	delete(raw, "type")
	// 不能用硬断言：面板下发的对象缺 tag（或 tag 不是字符串）时，
	// 这里会 panic；而 UnmarshalJSON 是在 agent 主循环里调的，没有 recover，
	// 结果就是 systemd 每 5 秒重启一次、无限崩溃循环。返回错误让上层跳过这条即可。
	tag, ok := raw["tag"].(string)
	if !ok || tag == "" {
		return fmt.Errorf("缺 tag 或 tag 不是字符串")
	}
	o.Tag = tag
	delete(raw, "tag")
	o.Ext, _ = json.MarshalIndent(raw["ext"], "", "  ")
	delete(raw, "ext")

	// Remaining fields
	o.Options, err = json.MarshalIndent(raw, "", "  ")
	return err
}

// MarshalJSON customizes marshalling
func (o Endpoint) MarshalJSON() ([]byte, error) {
	// Combine fixed fields and dynamic fields into one map
	combined := make(map[string]interface{})
	switch o.Type {
	case "warp":
		combined["type"] = "wireguard"
	default:
		combined["type"] = o.Type
	}
	combined["tag"] = o.Tag

	if o.Options != nil {
		var restFields map[string]json.RawMessage
		if err := json.Unmarshal(o.Options, &restFields); err != nil {
			return nil, err
		}

		for k, v := range restFields {
			combined[k] = v
		}
	}

	return json.Marshal(combined)
}
